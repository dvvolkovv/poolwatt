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

export type LedgerKind = "charge" | "reservation.no_show" | "other";

export interface LedgerLine {
  date: Date;
  documentNumber: string;
  receiptId: string;
  kind: LedgerKind;
  pointId: string | null;
  pointName: string | null;
  kwh: number;
  gross: number;
  net: number;
  vat: number;
  vatRatePct: number | null;
  currency: string;
}

export interface LedgerTotals {
  kwh: number;
  gross: number;
  net: number;
  vat: number;
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

export async function readLedger(args: {
  operatorId: string;
  from: Date;
  to: Date;
  /** null = every point of the network. */
  pointIds: string[] | null;
}): Promise<Ledger> {
  const operator = await prisma.chargerOperator.findUniqueOrThrow({
    where: { id: args.operatorId },
    include: { accounting: true },
  });
  const acc = operator.accounting;
  const vatRatePct = numOrNull(acc?.vatRatePct ?? null);

  const pointFilter = {
    operatorId: args.operatorId,
    ...(args.pointIds ? { id: { in: args.pointIds } } : {}),
  };

  // The period is half-open [from, to): two neighbouring months must not both
  // claim the same document.
  const window = { gte: args.from, lt: args.to };

  const receipts = await prisma.receipt.findMany({
    where: {
      issuedAt: window,
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
    return {
      date: r.issuedAt,
      documentNumber: r.number ?? r.id,
      receiptId: r.id,
      kind,
      pointId: point?.pointId ?? null,
      pointName: point?.point?.name ?? null,
      kwh: roundKwh(num(r.totalKwh)),
      gross,
      net: split?.net ?? gross,
      vat: split?.amount ?? 0,
      vatRatePct,
      currency: r.currency,
    };
  });

  const totals = lines.reduce<LedgerTotals>(
    (acc2, l) => ({
      kwh: roundKwh(acc2.kwh + l.kwh),
      gross: roundMoney(acc2.gross + l.gross),
      net: roundMoney(acc2.net + l.net),
      vat: roundMoney(acc2.vat + l.vat),
    }),
    { kwh: 0, gross: 0, net: 0, vat: 0 },
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
