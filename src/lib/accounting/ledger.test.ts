// US-46, §46 "Бухгалтерия партнёра" — the month a partner's accountant asks
// for. The export formats are only as good as these lines, so this is where
// the period boundaries, the scope of one network and the §47 point scope are
// pinned.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, PaymentStatus, PointStatus, PointType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateWallet } from "@/lib/exchange/wallet-service";
import { ensureBuiltInRoles, inviteEmployee } from "@/lib/staff/staff-service";
import { receiptStamp } from "@/lib/receipts/receipt-number";
import { accountingAccess, readLedger } from "./ledger";

const PREFIX = "test_ledger_";
const SLUG = `${PREFIX}net`;
const OTHER_SLUG = `${PREFIX}other`;
const ZONE = "TESTLEDGER";

let operatorId: string;
let otherOperatorId: string;
let ownerUserId: string;
let accountantUserId: string;
let engineerUserId: string;
let strangerUserId: string;
let zoneId: string;
let pointA: string;
let pointB: string;
let otherPoint: string;
let walletId: string;

async function wipe() {
  await prisma.paymentRefund.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.ticket.deleteMany({
    where: { operator: { slug: { in: [SLUG, OTHER_SLUG] } } },
  });
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.receipt.deleteMany({
    where: { reservation: { point: { operator: { slug: { in: [SLUG, OTHER_SLUG] } } } } },
  });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.reservation.deleteMany({
    where: { point: { operator: { slug: { in: [SLUG, OTHER_SLUG] } } } },
  });
  await prisma.employee.deleteMany({ where: { operator: { slug: { in: [SLUG, OTHER_SLUG] } } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: { in: [SLUG, OTHER_SLUG] } } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { in: [SLUG, OTHER_SLUG] } } },
  });
  await prisma.operatorAccounting.deleteMany({
    where: { operator: { slug: { in: [SLUG, OTHER_SLUG] } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { in: [SLUG, OTHER_SLUG] } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

async function seedUser(name: string) {
  return (await prisma.user.create({ data: { username: `${PREFIX}${name}`, passwordHash: "x" } })).id;
}

async function makePoint(opId: string, name: string) {
  return (
    await prisma.acceptancePoint.create({
      data: {
        operatorId: opId,
        type: PointType.CHARGING_STATION,
        name,
        status: PointStatus.PUBLISHED,
        paymentMethods: [],
        amenities: [],
      },
    })
  ).id;
}

async function charge(pointId: string, at: string, kwh: number, fiat: number) {
  const payment = await prisma.payment.create({
    data: {
      walletId,
      zoneId,
      pointId,
      startedAt: new Date(at),
      endedAt: new Date(at),
      requestedKwh: new Prisma.Decimal(kwh),
      kwhFromBalance: new Prisma.Decimal(kwh),
      amountFiat: new Prisma.Decimal(fiat),
      status: PaymentStatus.CAPTURED,
      capturedAt: new Date(at),
    },
  });
  return prisma.receipt.create({
    data: {
      ...(await receiptStamp(prisma, new Date(at))),
      paymentId: payment.id,
      burnedTokenIds: [],
      totalKwh: new Prisma.Decimal(kwh),
      totalFiat: new Prisma.Decimal(fiat),
      currency: "EUR",
      issuedAt: new Date(at),
      breakdown: { kind: "charge", kwhFromBalance: kwh } as Prisma.InputJsonValue,
    },
  });
}

beforeAll(async () => {
  await wipe();

  ownerUserId = await seedUser("owner");
  accountantUserId = await seedUser("acct");
  engineerUserId = await seedUser("eng");
  strangerUserId = await seedUser("stranger");

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, name: "Ledger", country: "SK", currency: "EUR" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: SLUG, displayName: "Ledger network", claimedById: ownerUserId },
    })
  ).id;
  otherOperatorId = (
    await prisma.chargerOperator.create({ data: { slug: OTHER_SLUG, displayName: "Somebody else" } })
  ).id;
  await prisma.operatorAccounting.create({
    data: { operatorId, legalName: "Ledger s.r.o.", vatRatePct: new Prisma.Decimal(20) },
  });

  pointA = await makePoint(operatorId, "Point A");
  pointB = await makePoint(operatorId, "Point B");
  otherPoint = await makePoint(otherOperatorId, "Not ours");

  walletId = (await getOrCreateWallet(ownerUserId, zoneId)).id;

  await ensureBuiltInRoles(operatorId);
  await inviteEmployee({
    operatorId,
    actorUserId: ownerUserId,
    username: `${PREFIX}acct`,
    roleName: "ACCOUNTANT",
    pointIds: [pointA],
  });
  await inviteEmployee({
    operatorId,
    actorUserId: ownerUserId,
    username: `${PREFIX}eng`,
    roleName: "ENGINEER",
    pointIds: [],
  });

  // March: two charges at A, one at B. February and April: one each, outside.
  await charge(pointA, "2026-03-02T10:00:00Z", 10, 4.2);
  await charge(pointA, "2026-03-20T18:00:00Z", 5, 2.1);
  await charge(pointB, "2026-03-15T08:00:00Z", 20, 8.4);
  await charge(pointA, "2026-02-27T10:00:00Z", 7, 3);
  await charge(pointA, "2026-04-01T00:00:00Z", 9, 4);
  // Somebody else's network, same month.
  const otherPayment = await prisma.payment.create({
    data: {
      walletId,
      zoneId,
      pointId: otherPoint,
      requestedKwh: new Prisma.Decimal(100),
      amountFiat: new Prisma.Decimal(40),
      status: PaymentStatus.CAPTURED,
      capturedAt: new Date("2026-03-10T10:00:00Z"),
    },
  });
  await prisma.receipt.create({
    data: {
      ...(await receiptStamp(prisma, new Date("2026-03-10T10:00:00Z"))),
      paymentId: otherPayment.id,
      burnedTokenIds: [],
      totalKwh: new Prisma.Decimal(100),
      totalFiat: new Prisma.Decimal(40),
      currency: "EUR",
      issuedAt: new Date("2026-03-10T10:00:00Z"),
      breakdown: { kind: "charge" } as Prisma.InputJsonValue,
    },
  });

  // A no-show penalty belongs in the month's books too (§35, §46).
  const reservation = await prisma.reservation.create({
    data: {
      userId: ownerUserId,
      pointId: pointB,
      connectorId: (
        await prisma.pointConnector.create({
          data: { pointId: pointB, type: "CCS2", powerKw: new Prisma.Decimal(50) },
        })
      ).id,
      walletId,
      eta: new Date("2026-03-18T09:00:00Z"),
      windowStart: new Date("2026-03-18T08:45:00Z"),
      windowEnd: new Date("2026-03-18T09:15:00Z"),
      feeFiat: new Prisma.Decimal(1),
      guaranteeFiat: new Prisma.Decimal(5),
      noShowPenaltyFiat: new Prisma.Decimal(3),
      freeCancelMinutes: 30,
      status: "NO_SHOW",
    },
  });
  await prisma.receipt.create({
    data: {
      ...(await receiptStamp(prisma, new Date("2026-03-18T09:15:00Z"))),
      reservationId: reservation.id,
      burnedTokenIds: [],
      totalKwh: new Prisma.Decimal(0),
      totalFiat: new Prisma.Decimal(3),
      currency: "EUR",
      issuedAt: new Date("2026-03-18T09:15:00Z"),
      breakdown: { kind: "reservation.no_show", penalty: 3 } as Prisma.InputJsonValue,
    },
  });
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const MARCH = { from: new Date("2026-03-01T00:00:00Z"), to: new Date("2026-04-01T00:00:00Z") };

describe("readLedger", () => {
  it("returns the month's documents for this network and nobody else's", async () => {
    const ledger = await readLedger({ operatorId, ...MARCH, pointIds: null });
    expect(ledger.lines).toHaveLength(4);
    expect(ledger.lines.every((l) => l.pointName !== "Not ours")).toBe(true);
  });

  it("keeps the period half-open, so months do not overlap", async () => {
    const ledger = await readLedger({ operatorId, ...MARCH, pointIds: null });
    const dates = ledger.lines.map((l) => l.date.toISOString().slice(0, 10));
    expect(dates).not.toContain("2026-02-27");
    expect(dates).not.toContain("2026-04-01");
  });

  it("totals the month in money, VAT and kWh", async () => {
    const ledger = await readLedger({ operatorId, ...MARCH, pointIds: null });
    expect(ledger.totals.gross).toBeCloseTo(4.2 + 2.1 + 8.4 + 3, 2);
    expect(ledger.totals.kwh).toBeCloseTo(35, 3);
    expect(ledger.totals.net + ledger.totals.vat).toBeCloseTo(ledger.totals.gross, 2);
    expect(ledger.currency).toBe("EUR");
  });

  it("marks each line with what it is", async () => {
    const ledger = await readLedger({ operatorId, ...MARCH, pointIds: null });
    const kinds = ledger.lines.map((l) => l.kind).sort();
    expect(kinds).toEqual(["charge", "charge", "charge", "reservation.no_show"]);
  });

  it("carries the document number, so a line can be traced to its receipt", async () => {
    const ledger = await readLedger({ operatorId, ...MARCH, pointIds: null });
    for (const line of ledger.lines) {
      expect(line.documentNumber).toMatch(/^PW-2026-\d{6}$/);
      expect(line.receiptId).toBeTruthy();
    }
  });

  it("shows an accountant only the points they were given — §47", async () => {
    const access = await accountingAccess(operatorId, accountantUserId);
    expect(access.allowed).toBe(true);
    const ledger = await readLedger({ operatorId, ...MARCH, pointIds: access.pointIds });
    expect(ledger.lines.map((l) => l.pointName)).toEqual(["Point A", "Point A"]);
  });

  it("gives the owner the whole network", async () => {
    const access = await accountingAccess(operatorId, ownerUserId);
    expect(access).toMatchObject({ allowed: true, pointIds: null, isOwner: true });
  });

  it("refuses the engineer: no finance.read", async () => {
    const access = await accountingAccess(operatorId, engineerUserId);
    expect(access.allowed).toBe(false);
  });

  it("refuses somebody who does not work here", async () => {
    const access = await accountingAccess(operatorId, strangerUserId);
    expect(access.allowed).toBe(false);
  });

  it("is empty, not broken, for a month with nothing in it", async () => {
    const ledger = await readLedger({
      operatorId,
      from: new Date("2025-01-01T00:00:00Z"),
      to: new Date("2025-02-01T00:00:00Z"),
      pointIds: null,
    });
    expect(ledger.lines).toEqual([]);
    expect(ledger.totals.gross).toBe(0);
  });

  it("carries the network's requisites, so a format can print them", async () => {
    const ledger = await readLedger({ operatorId, ...MARCH, pointIds: null });
    expect(ledger.network).toMatchObject({ displayName: "Ledger network", legalName: "Ledger s.r.o." });
    expect(ledger.vatRatePct).toBe(20);
  });
});

// §46 — "исправление по регламенту": what a corrected document does to the
// month an accountant exports.
describe("readLedger and corrected documents", () => {
  it("prints the number of the version in force and counts the month once", async () => {
    const before = await readLedger({ operatorId, ...MARCH, pointIds: null });
    const original = await charge(pointA, "2026-03-20T10:00:00Z", 10, 3);

    const corrected = await prisma.receipt.create({
      data: {
        ...(await receiptStamp(prisma, new Date("2026-03-25T10:00:00Z"))),
        correctsReceiptId: original.id,
        documentVersion: 2,
        burnedTokenIds: [],
        totalKwh: original.totalKwh,
        totalFiat: original.totalFiat,
        currency: original.currency,
        issuedAt: new Date("2026-03-25T10:00:00Z"),
        breakdown: original.breakdown as Prisma.InputJsonValue,
      },
    });

    const after = await readLedger({ operatorId, ...MARCH, pointIds: null });

    // One new line for one sale, not two.
    expect(after.lines).toHaveLength(before.lines.length + 1);
    expect(after.totals.gross).toBe(roundTo2(before.totals.gross + 3));

    const line = after.lines.find((l) => l.receiptId === original.id)!;
    expect(line.documentNumber).toBe(corrected.number);
    expect(line.correctedReceiptId).toBe(corrected.id);
    // The money is the original's, unchanged.
    expect(line.gross).toBe(3);

    await prisma.receipt.delete({ where: { id: corrected.id } });
    await prisma.receipt.delete({ where: { id: original.id } });
  });
});

function roundTo2(v: number): number {
  return Math.round(v * 100) / 100;
}

// §51 «Ошибочное списание — возврат после проверки поддержкой». Возврат — не
// исправление чека, а новый факт, и месяц партнёра обязан его видеть: иначе
// выгрузка навсегда завысит выручку сети, и заметить это будет нечем.
describe("readLedger and a §51 refund", () => {
  const MAY = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-06-01T00:00:00Z") };
  let refundNumber: string;

  beforeAll(async () => {
    const receipt = await charge(pointA, "2026-05-04T10:00:00Z", 25, 10);
    const paymentId = receipt.paymentId!;
    const ticket = await prisma.ticket.create({
      data: {
        operatorId,
        pointId: pointA,
        paymentId,
        reporterId: ownerUserId,
        problemType: "WRONG_PRICE",
      },
    });
    refundNumber = (
      await prisma.paymentRefund.create({
        data: {
          paymentId,
          ticketId: ticket.id,
          walletId,
          number: "PW-2026-RF9001",
          amountFiat: new Prisma.Decimal(4.2),
          currency: "EUR",
          reason: "wrong tariff",
          decidedById: ownerUserId,
          createdAt: new Date("2026-05-06T12:00:00Z"),
        },
      })
    ).number;
  });

  it("is a negative line of its own, with its document number", async () => {
    const ledger = await readLedger({ operatorId, ...MAY, pointIds: null });
    const line = ledger.lines.find((l) => l.kind === "refund");
    expect(line).toBeDefined();
    expect(line!.documentNumber).toBe(refundNumber);
    expect(line!.gross).toBe(-4.2);
    expect(line!.kwh).toBe(0);
    expect(line!.pointName).toBe("Point A");
  });

  it("the month sums with the refund taken off", async () => {
    const ledger = await readLedger({ operatorId, ...MAY, pointIds: null });
    expect(ledger.totals.gross).toBeCloseTo(10 - 4.2, 2);
    expect(ledger.totals.net + ledger.totals.vat).toBeCloseTo(ledger.totals.gross, 2);
  });

  it("stays out of a month it does not belong to", async () => {
    const ledger = await readLedger({ operatorId, ...MARCH, pointIds: null });
    expect(ledger.lines.some((l) => l.kind === "refund")).toBe(false);
  });

  it("§47 — an accountant with other points does not see it", async () => {
    const access = await accountingAccess(operatorId, accountantUserId, "USER");
    const ledger = await readLedger({ operatorId, ...MAY, pointIds: access!.pointIds });
    // Точка A как раз разрешена этому бухгалтеру, поэтому возврат видно.
    expect(ledger.lines.some((l) => l.kind === "refund")).toBe(true);
    const narrowed = await readLedger({ operatorId, ...MAY, pointIds: [pointB] });
    expect(narrowed.lines.some((l) => l.kind === "refund")).toBe(false);
  });
});
