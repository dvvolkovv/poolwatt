// US-46, §46 "Бухгалтерия партнёра" — the period an accountant exports.
//
// One reader turns a network's receipts into neutral lines, and the five
// formats (CSV, Excel, PDF, DATEV, BMD) render those lines. Keeping the
// reading in one place is what makes the five files agree with each other and
// with the receipt a driver holds.
//
// Scope is two things at once, as §47 demands: the network, and the points
// that particular employee was given. An accountant with two of fifty points
// exports two points.

import { prisma } from "@/lib/prisma";
import { num, numOrNull } from "@/lib/exchange/decimal";
import { roundKwh, roundMoney } from "@/lib/exchange/precision";
import { splitVat } from "@/lib/receipts/vat";
import { can, readEmployee } from "@/lib/staff/staff-service";

export type LedgerKind = "charge" | "reservation.no_show" | "refund" | "other";

export interface LedgerLine {
  date: Date;
  /** §46 — the number of the version in force, not of a corrected original. */
  documentNumber: string;
  receiptId: string;
  /** Set when this line's document has been corrected (§46's journal). */
  correctedReceiptId: string | null;
  kind: LedgerKind;
  pointId: string | null;
  pointName: string | null;
  kwh: number;
  gross: number;
  net: number;
  vat: number;
  vatRatePct: number | null;
  currency: string;
  // §54 "Расчёт комиссий … с отражением в облачной бухгалтерии обеих сторон".
  // Taken from the receipt rather than recomputed: a rate that changed since
  // must not move what a closed month says (§54's versioning).
  platformFee: number;
  /** §52 — what the head network took, when this point is a franchisee's. */
  subpartnerFee: number;
  /** Gross less both commissions: what this network actually keeps. */
  partnerNet: number;
}

export interface LedgerTotals {
  kwh: number;
  gross: number;
  net: number;
  vat: number;
  platformFee: number;
  subpartnerFee: number;
  partnerNet: number;
}

export interface LedgerNetwork {
  operatorId: string;
  displayName: string;
  legalName: string | null;
  regNumber: string | null;
  vatNumber: string | null;
  address: string | null;
}

export interface Ledger {
  network: LedgerNetwork;
  from: Date;
  to: Date;
  currency: string;
  vatRatePct: number | null;
  lines: LedgerLine[];
  totals: LedgerTotals;
  /** DATEV and BMD need these; empty means those two formats must refuse. */
  accounts: {
    datevConsultantNo: string | null;
    datevClientNo: string | null;
    revenueAccount: string | null;
    counterAccount: string | null;
    fiscalYearStart: number;
    bmdClientNo: string | null;
  };
}

export interface AccountingAccess {
  allowed: boolean;
  isOwner: boolean;
  /** null = the whole network, an array = exactly these points. */
  pointIds: string[] | null;
}

/**
 * Who may read a network's books: its owner, the platform operator, and an
 * employee whose role carries `finance.read` — the built-in ACCOUNTANT of §47.
 */
export async function accountingAccess(
  operatorId: string,
  userId: string,
  isPlatformAdmin = false,
): Promise<AccountingAccess> {
  const operator = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { claimedById: true },
  });
  if (!operator) return { allowed: false, isOwner: false, pointIds: [] };
  if (operator.claimedById === userId || isPlatformAdmin) {
    return { allowed: true, isOwner: operator.claimedById === userId, pointIds: null };
  }

  const employee = await readEmployee(operatorId, userId);
  if (!employee || !can(employee, "finance.read")) {
    return { allowed: false, isOwner: false, pointIds: [] };
  }
  return {
    allowed: true,
    isOwner: false,
    pointIds: employee.pointIds.length === 0 ? null : employee.pointIds,
  };
}

/**
 * §46 — the last version of each of these receipts, when it has been
 * corrected. One query per step of the chain, and a chain is one step long in
 * practice; a corrected correction still resolves to the last document.
 */
async function versionsInForce(
  receiptIds: string[],
): Promise<Map<string, { id: string; number: string | null }>> {
  const latest = new Map<string, { id: string; number: string | null }>();
  if (receiptIds.length === 0) return latest;

  // Which original every version in the chain belongs to.
  const rootOf = new Map<string, string>(receiptIds.map((id) => [id, id]));
  let frontier = receiptIds;

  while (frontier.length > 0) {
    const next = await prisma.receipt.findMany({
      where: { correctsReceiptId: { in: frontier } },
      select: { id: true, number: true, correctsReceiptId: true },
    });
    if (next.length === 0) break;

    frontier = [];
    for (const row of next) {
      const root = rootOf.get(row.correctsReceiptId!);
      if (!root) continue;
      rootOf.set(row.id, root);
      latest.set(root, { id: row.id, number: row.number });
      frontier.push(row.id);
    }
  }

  return latest;
}

/**
 * A commission as the receipt recorded it. Missing means nothing was taken —
 * which is true of every receipt written before §54's commissions were kept.
 */
function feeFrom(b: Record<string, unknown>, key: string): number {
  const v = b[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? roundMoney(v) : 0;
}

export async function readLedger(args: {
  operatorId: string;
  from: Date;
  to: Date;
  /** null = every point of the network. */
  pointIds: string[] | null;
  /**
   * §54 — read the same sessions from the head network's side: the ones at
   * its franchisees' points, where its own commission came from. The numbers
   * are the same rows, so the two sets of books cannot disagree.
   */
  asSubpartnerHead?: boolean;
}): Promise<Ledger> {
  const operator = await prisma.chargerOperator.findUniqueOrThrow({
    where: { id: args.operatorId },
    include: { accounting: true },
  });
  const acc = operator.accounting;
  const vatRatePct = numOrNull(acc?.vatRatePct ?? null);

  const pointFilter = args.asSubpartnerHead
    ? {
        operator: { subpartnerOf: { some: { headId: args.operatorId, active: true } } },
        ...(args.pointIds ? { id: { in: args.pointIds } } : {}),
      }
    : {
        operatorId: args.operatorId,
        ...(args.pointIds ? { id: { in: args.pointIds } } : {}),
      };

  // The period is half-open [from, to): two neighbouring months must not both
  // claim the same document.
  const window = { gte: args.from, lt: args.to };

  const receipts = await prisma.receipt.findMany({
    where: {
      issuedAt: window,
      // §46 — a corrected version is not a second sale. The original keeps its
      // place in the month (its amounts never changed), and the correction is
      // only a different document for the same money; counting both would
      // double the month.
      correctsReceiptId: null,
      OR: [
        { payment: { point: pointFilter } },
        { reservation: { point: pointFilter } },
      ],
    },
    orderBy: { issuedAt: "asc" },
    select: {
      id: true,
      number: true,
      issuedAt: true,
      totalKwh: true,
      totalFiat: true,
      currency: true,
      breakdown: true,
      paymentId: true,
      reservationId: true,
      payment: { select: { pointId: true, point: { select: { name: true } } } },
      reservation: { select: { pointId: true, point: { select: { name: true } } } },
    },
  });

  // §46 — which document is in force for each of these receipts.
  const inForce = await versionsInForce(receipts.map((r) => r.id));

  const lines: LedgerLine[] = receipts.map((r) => {
    const gross = num(r.totalFiat);
    const split = splitVat(gross, vatRatePct);
    const b = (r.breakdown ?? {}) as Record<string, unknown>;
    const kind: LedgerKind =
      b.kind === "charge" || b.kind === "reservation.no_show"
        ? b.kind
        : r.paymentId
          ? "charge"
          : r.reservationId
            ? "reservation.no_show"
            : "other";
    const point = r.payment ?? r.reservation;
    const current = inForce.get(r.id) ?? null;
    return {
      date: r.issuedAt,
      documentNumber: current?.number ?? r.number ?? r.id,
      receiptId: r.id,
      correctedReceiptId: current?.id ?? null,
      kind,
      pointId: point?.pointId ?? null,
      pointName: point?.point?.name ?? null,
      kwh: roundKwh(num(r.totalKwh)),
      gross,
      platformFee: feeFrom(b, "platformFee"),
      subpartnerFee: feeFrom(b, "subpartnerFee"),
      partnerNet: roundMoney(
        gross - feeFrom(b, "platformFee") - feeFrom(b, "subpartnerFee"),
      ),
      net: split?.net ?? gross,
      vat: split?.amount ?? 0,
      vatRatePct,
      currency: r.currency,
    };
  });

  // §51 — возврат ошибочного списания. Второй источник строк, а не чек: чек
  // на зарядку остаётся верным, зарядка была, а возврат — новый факт. Без
  // этой строки выгрузка навсегда завысила бы выручку сети, и заметить это
  // было бы нечем — чек-то верный.
  const refunds = await prisma.paymentRefund.findMany({
    where: { createdAt: window, payment: { point: pointFilter } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      number: true,
      createdAt: true,
      amountFiat: true,
      currency: true,
      payment: { select: { pointId: true, point: { select: { name: true } } } },
    },
  });

  for (const r of refunds) {
    const gross = roundMoney(-num(r.amountFiat));
    const split = splitVat(gross, vatRatePct);
    lines.push({
      date: r.createdAt,
      documentNumber: r.number,
      receiptId: r.id,
      correctedReceiptId: null,
      kind: "refund",
      pointId: r.payment.pointId,
      pointName: r.payment.point?.name ?? null,
      kwh: 0,
      gross,
      net: split?.net ?? gross,
      vat: split?.amount ?? 0,
      vatRatePct,
      currency: r.currency,
      // Комиссии §53/§52 брались со зарядки и возвратом не двигаются: их
      // перерасчёт — вопрос договора с партнёром, а не этой строки.
      platformFee: 0,
      subpartnerFee: 0,
      partnerNet: gross,
    });
  }
  lines.sort((a, b) => a.date.getTime() - b.date.getTime());

  const totals = lines.reduce<LedgerTotals>(
    (acc2, l) => ({
      kwh: roundKwh(acc2.kwh + l.kwh),
      gross: roundMoney(acc2.gross + l.gross),
      net: roundMoney(acc2.net + l.net),
      vat: roundMoney(acc2.vat + l.vat),
      platformFee: roundMoney(acc2.platformFee + l.platformFee),
      subpartnerFee: roundMoney(acc2.subpartnerFee + l.subpartnerFee),
      partnerNet: roundMoney(acc2.partnerNet + l.partnerNet),
    }),
    { kwh: 0, gross: 0, net: 0, vat: 0, platformFee: 0, subpartnerFee: 0, partnerNet: 0 },
  );

  return {
    network: {
      operatorId: operator.id,
      displayName: operator.displayName,
      legalName: acc?.legalName ?? null,
      regNumber: acc?.regNumber ?? null,
      vatNumber: acc?.vatNumber ?? null,
      address: [acc?.addressLine, acc?.city, acc?.country].filter(Boolean).join(", ") || null,
    },
    from: args.from,
    to: args.to,
    // Zones in one network share a currency in practice; the first line
    // decides, and a mixed period keeps each line's own currency anyway.
    currency: lines[0]?.currency ?? "EUR",
    vatRatePct,
    lines,
    totals,
    accounts: {
      datevConsultantNo: acc?.datevConsultantNo ?? null,
      datevClientNo: acc?.datevClientNo ?? null,
      revenueAccount: acc?.revenueAccount ?? null,
      counterAccount: acc?.counterAccount ?? null,
      fiscalYearStart: acc?.fiscalYearStart ?? 1,
      bmdClientNo: acc?.bmdClientNo ?? null,
    },
  };
}
