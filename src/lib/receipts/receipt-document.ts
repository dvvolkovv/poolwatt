// The receipt as a document — ТЗ §46 "Состав чека".
//
// One function builds it, and everything that shows a receipt reads the
// result: the page in the wallet, the print view for a station terminal, the
// email, and the accountant's export. A receipt rendered twice from two
// different readers is two different documents, and only one of them can be
// right.
//
// What the document never does is fill a gap with a plausible number. No
// VAT rate from the partner means the tax line says so; no point behind the
// payment means no branding. The row holds what happened; this maps it.

import type { AssetKind, Prisma } from "@prisma/client";
import { pricingVersion } from "@/lib/pricing/pricing-service";
import { prisma } from "@/lib/prisma";
import { num, numOrNull } from "@/lib/exchange/decimal";
import { roundKwh, roundMoney } from "@/lib/exchange/precision";
import { splitVat, type VatSplit } from "./vat";
import { tariffAtDate } from "@/lib/points/point-tariff";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export type ReceiptKind = "charge" | "trade" | "reservation.no_show" | "other";

export interface ReceiptNetwork {
  operatorId: string;
  displayName: string;
  /** The point's own logo wins over the network's: §28 "Бренд". */
  logoUrl: string | null;
  legalName: string | null;
  regNumber: string | null;
  vatNumber: string | null;
  address: string | null;
}

export interface ReceiptSession {
  pointId: string | null;
  pointName: string | null;
  pointAddress: string | null;
  connector: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface ReceiptPaymentSplit {
  /** §46 item 5 — kWh taken off the wallet's own balance. */
  fromBalanceKwh: number;
  /** Promo kWh (§43). Zero until the gift module lands; the line hides itself. */
  fromGiftKwh: number;
  /** kWh bought for this session on the exchange or from the aggregator. */
  boughtKwh: number;
  boughtFiat: number;
  /**
   * What was taken in money. No card processor exists yet, so this is the
   * wallet's fiat balance — the same money path US-08 uses.
   */
  cardFiat: number;
}

export interface ReceiptRoaming {
  /** The zone whose balance paid for this session. */
  homeZone: string | null;
  partnerName: string | null;
  /** Home-zone kWh per 1 kWh delivered here. */
  conversionRate: number | null;
  /** kWh the clearing partner delivered. */
  kwh: number;
  /** Home-zone kWh burned for them, the corridor fee included. */
  debitedKwh: number;
  feeKwh: number;
}

export interface ReceiptDocument {
  id: string;
  number: string | null;
  kind: ReceiptKind;
  issuedAt: Date;
  currency: string;

  network: ReceiptNetwork | null;
  session: ReceiptSession | null;
  /**
   * §46 lists the point, which an exchange purchase does not have. The zone
   * is then the only honest answer to "where": a trade receipt without it
   * says nothing about where those kWh live.
   */
  zone: string | null;

  totalKwh: number;
  totalFiat: number;
  /** §46 item 3 — the asset kinds behind the burned batches. */
  energySources: AssetKind[];

  pricePerKwhFiat: number | null;
  /** §46 item 4 — "цена за кВт·ч в токенах". One token is one kWh. */
  pricePerKwhTokens: number | null;

  reservationFee: number | null;
  reservationCredit: number | null;

  payment: ReceiptPaymentSplit;
  /**
   * §8 "Роуминг", US-11 — the corridor a session abroad leaned on. Null for a
   * session that stayed in one zone, which is almost all of them.
   */
  roaming: ReceiptRoaming | null;

  /**
   * §46 item 6 "Начисленный кэшбэк". US-12 pays it back in promo kWh out of
   * the partner's own generation; the money half waits for the EMI, and
   * `cashbackFiat` is where it will go.
   */
  cashbackKwh: number | null;
  cashbackPct: number | null;
  cashbackFiat: number | null;
  bonusKwh: number | null;

  vat: VatSplit | null;
  taxNote: string | null;

  verifyUrl: string | null;
  burnedTokenIds: string[];
}

type Breakdown = Record<string, unknown>;

function numberFrom(b: Breakdown, key: string): number | null {
  const v = b[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function kindOf(b: Breakdown, receipt: { paymentId: string | null; tradeId: string | null; reservationId: string | null }): ReceiptKind {
  const declared = typeof b.kind === "string" ? b.kind : null;
  if (declared === "charge" || declared === "trade" || declared === "reservation.no_show") {
    return declared;
  }
  if (receipt.paymentId) return "charge";
  if (receipt.tradeId) return "trade";
  if (receipt.reservationId) return "reservation.no_show";
  return "other";
}

function joinAddress(parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter((p): p is string => Boolean(p?.trim()));
  return kept.length > 0 ? kept.join(", ") : null;
}

/**
 * §46 item 4 — how many tokens one kWh cost. The point's tariff decides when
 * it says so (a network may charge a surcharge in tokens); otherwise it is the
 * ratio actually burned, which for a plain balance payment is 1.000.
 */
function tokenPrice(
  tariffTokens: number | null,
  burnedKwh: number,
  deliveredKwh: number,
): number | null {
  if (tariffTokens != null && tariffTokens > 0) return tariffTokens;
  if (burnedKwh > 0 && deliveredKwh > 0) return roundKwh(burnedKwh / deliveredKwh);
  return null;
}

/**
 * §54 — the tariff this receipt was issued under.
 *
 * A payment stamped with a version gets that version's snapshot, so an issued
 * document never changes when the partner edits the price. A payment from
 * before versions existed, or one at a point that never had a tariff, falls
 * back to the live rows: that is the best the data allows, and it is what the
 * receipt already did.
 */
async function tariffForReceipt(args: {
  pointId: string | null;
  tariffVersion: number | null;
  liveTariffs: TariffShape[];
  at: Date | null;
  /** Страна пункта: окно суток считается по его часам, а не по UTC. */
  country: string | null;
}): Promise<TariffShape | null> {
  if (args.pointId && args.tariffVersion != null) {
    const rule = await pricingVersion("POINT_TARIFF", args.pointId, args.tariffVersion);
    const params = rule?.params as { tariffs?: TariffShape[] } | null;
    if (params?.tariffs && params.tariffs.length > 0) {
      return tariffAtDate(params.tariffs, args.at, args.country);
    }
  }
  return tariffAtDate(args.liveTariffs, args.at, args.country);
}

/**
 * What a tariff row looks like, live or as a stored snapshot. The live rows
 * carry `Prisma.Decimal`; the snapshot in `PricingRule.params` carries plain
 * numbers, because that is what JSON holds.
 */
interface TariffShape {
  fromMinute: number;
  toMinute: number;
  priceFiat?: Prisma.Decimal | number | string | null;
  priceTokens?: Prisma.Decimal | number | string | null;
  idleFeePerMin?: Prisma.Decimal | number | string | null;
  coopDiscount?: number | null;
}

export async function buildReceiptDocument(
  receiptId: string,
): Promise<ReceiptDocument | null> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: {
      payment: {
        include: {
          point: { include: { tariffs: true, operator: { include: { accounting: true } } } },
          connector: true,
          zone: { select: { code: true } },
        },
      },
      trade: { include: { zone: { select: { code: true } } } },
      reservation: {
        include: {
          point: { include: { tariffs: true, operator: { include: { accounting: true } } } },
          connector: true,
        },
      },
    },
  });
  if (!receipt) return null;

  const b = (receipt.breakdown ?? {}) as Breakdown;
  const kind = kindOf(b, receipt);
  const point = receipt.payment?.point ?? receipt.reservation?.point ?? null;
  const connector = receipt.payment?.connector ?? receipt.reservation?.connector ?? null;
  const accounting = point?.operator.accounting ?? null;

  const network: ReceiptNetwork | null = point
    ? {
        operatorId: point.operatorId,
        displayName: point.operator.displayName,
        logoUrl: point.logoUrl ?? point.operator.logoUrl ?? null,
        legalName: accounting?.legalName ?? null,
        regNumber: accounting?.regNumber ?? null,
        vatNumber: accounting?.vatNumber ?? null,
        address: joinAddress([accounting?.addressLine, accounting?.city, accounting?.country]),
      }
    : null;

  const session: ReceiptSession | null = point
    ? {
        pointId: point.id,
        pointName: point.name,
        pointAddress: joinAddress([point.addressLine, point.city, point.country]),
        connector: connector
          ? `${connector.type} · ${num(connector.powerKw)} kW`
          : null,
        startedAt: receipt.payment?.startedAt ?? receipt.reservation?.windowStart ?? null,
        endedAt: receipt.payment?.endedAt ?? receipt.reservation?.windowEnd ?? null,
      }
    : null;

  const totalKwh = num(receipt.totalKwh);
  const totalFiat = num(receipt.totalFiat);

  const energySources = await readEnergySources(receipt.burnedTokenIds);

  const fromBalanceKwh =
    numberFrom(b, "kwhFromBalance") ?? (receipt.payment ? num(receipt.payment.kwhFromBalance) : 0);
  const boughtKwh =
    numberFrom(b, "kwhBought") ?? (receipt.payment ? num(receipt.payment.kwhBought) : 0);
  const boughtFiat = numberFrom(b, "energyCost") ?? (kind === "charge" ? totalFiat : 0);
  const fromGiftKwh = numberFrom(b, "kwhFromGift") ?? 0;
  const roamingKwh =
    numberFrom(b, "kwhFromRoaming") ?? (receipt.payment ? num(receipt.payment.kwhFromRoaming) : 0);
  const roaming: ReceiptRoaming | null =
    roamingKwh > 0
      ? {
          homeZone: typeof b.roamingHomeZone === "string" ? b.roamingHomeZone : null,
          partnerName: typeof b.roamingPartner === "string" ? b.roamingPartner : null,
          conversionRate: numberFrom(b, "roamingRate"),
          kwh: roundKwh(roamingKwh),
          debitedKwh: roundKwh(numberFrom(b, "roamingDebitKwh") ?? 0),
          feeKwh: roundKwh(numberFrom(b, "roamingFeeKwh") ?? 0),
        }
      : null;

  const tariff = await tariffForReceipt({
    pointId: point?.id ?? null,
    tariffVersion: receipt.payment?.tariffVersion ?? null,
    liveTariffs: point?.tariffs ?? [],
    at: session?.startedAt ?? null,
    country: point?.country ?? null,
  });
  // What the driver's own tokens covered, wherever they lived: the token
  // price of §46.4 counts roaming kWh too — they were paid for in tokens.
  const burnedKwh = fromBalanceKwh + fromGiftKwh + roamingKwh;

  const pricePerKwhFiat =
    numberFrom(b, "price") ??
    (boughtKwh > 0 && boughtFiat > 0 ? roundMoney4(boughtFiat / boughtKwh) : numOrNull(tariff?.priceFiat ?? null));

  return {
    id: receipt.id,
    number: receipt.number,
    kind,
    issuedAt: receipt.issuedAt,
    currency: receipt.currency,
    network,
    session,
    zone:
      (typeof b.zone === "string" ? b.zone : null) ??
      receipt.payment?.zone.code ??
      receipt.trade?.zone.code ??
      null,
    totalKwh,
    totalFiat,
    energySources,
    pricePerKwhFiat,
    pricePerKwhTokens: tokenPrice(numOrNull(tariff?.priceTokens ?? null), burnedKwh, totalKwh),
    reservationFee: numberFrom(b, "reservationFee") ?? numberFrom(b, "fee"),
    reservationCredit: numberFrom(b, "reservationCredit"),
    payment: {
      fromBalanceKwh: roundKwh(fromBalanceKwh),
      fromGiftKwh: roundKwh(fromGiftKwh),
      boughtKwh: roundKwh(boughtKwh),
      boughtFiat: roundMoney(boughtFiat),
      cardFiat: roundMoney(kind === "charge" ? boughtFiat : totalFiat),
    },
    roaming,
    cashbackKwh: numberFrom(b, "cashbackKwh"),
    cashbackPct: numberFrom(b, "cashbackPct"),
    cashbackFiat: numberFrom(b, "cashbackFiat"),
    bonusKwh: numberFrom(b, "bonusKwh"),
    vat: splitVat(totalFiat, numOrNull(accounting?.vatRatePct ?? null)),
    taxNote: accounting?.taxNote ?? null,
    verifyUrl: receipt.verifyCode ? `${BASE}/r/${receipt.verifyCode}` : null,
    burnedTokenIds: receipt.burnedTokenIds,
  };
}

/** Four decimals: a per-kWh price of 0.42 must not round to 0.42 EUR of noise. */
function roundMoney4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * §46 item 3 — where the energy came from. The batches know; the point's sign
 * does not: a station branded "solar" can hand over a kWh a wind farm minted.
 */
async function readEnergySources(tokenIds: string[]): Promise<AssetKind[]> {
  if (tokenIds.length === 0) return [];
  const tokens = await prisma.energyToken.findMany({
    where: { id: { in: tokenIds } },
    select: { asset: { select: { kind: true } } },
  });
  return [...new Set(tokens.map((t) => t.asset.kind))].sort();
}
