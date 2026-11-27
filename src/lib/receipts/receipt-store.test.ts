// §46 — a receipt is a document, not a view over live rows.
//
// The case that matters most is the second one: before this file existed, a
// partner editing their VAT rate rewrote every receipt they had ever issued,
// including months an accountant had already exported.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  Prisma,
  AssetKind,
  AssetStatus,
  EnergyTokenStatus,
  EvConnectorType,
  PaymentStatus,
  PointStatus,
  PointType,
  CompanyType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateWallet } from "@/lib/exchange/wallet-service";
import { receiptStamp } from "./receipt-number";
import { readReceiptDocument } from "./receipt-store";

const PREFIX = "test_rstore_";
const SLUG = `${PREFIX}net`;
const ZONE = "TESTRSTOR";

let operatorId: string;
let pointId: string;
let connectorId: string;
let zoneId: string;
let userId: string;
let walletId: string;
let companyId: string;
let assetId: string;

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.asset.deleteMany({ where: { company: { legalName: { startsWith: PREFIX } } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.operatorAccounting.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();

  userId = (
    await prisma.user.create({ data: { username: `${PREFIX}driver`, passwordHash: "x" } })
  ).id;
  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, name: "Receipt store zone", country: "SK", currency: "EUR" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: SLUG, displayName: "Frozen network" },
    })
  ).id;
  await prisma.operatorAccounting.create({
    data: {
      operatorId,
      legalName: "Frozen network s.r.o.",
      regNumber: "12345678",
      vatNumber: "SK2020123456",
      addressLine: "Hlavná 1",
      city: "Košice",
      country: "SK",
      vatRatePct: new Prisma.Decimal(20),
    },
  });
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: PointType.CHARGING_STATION,
      name: "Košice — Hlavná",
      status: PointStatus.PUBLISHED,
      country: "SK",
      city: "Košice",
      addressLine: "Hlavná 1",
      gridZoneId: zoneId,
      paymentMethods: [],
      amenities: [],
    },
  });
  pointId = point.id;
  connectorId = (
    await prisma.pointConnector.create({
      data: { pointId, type: EvConnectorType.CCS2, powerKw: new Prisma.Decimal(150), quantity: 1 },
    })
  ).id;

  companyId = (
    await prisma.company.create({
      data: {
        legalName: `${PREFIX}producer`,
        country: "SK",
        regNumber: `${PREFIX}1`,
        type: CompanyType.PRODUCER,
      },
    })
  ).id;
  assetId = (
    await prisma.asset.create({
      data: {
        companyId,
        kind: AssetKind.SOLAR,
        name: "Roof",
        capacityKw: new Prisma.Decimal(10),
        gridZoneId: zoneId,
        status: AssetStatus.ACTIVE,
      },
    })
  ).id;
  walletId = (await getOrCreateWallet(userId, zoneId)).id;
});

beforeEach(async () => {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.operatorAccounting.update({
    where: { operatorId },
    data: { vatRatePct: new Prisma.Decimal(20), legalName: "Frozen network s.r.o." },
  });
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

async function chargeReceipt() {
  const payment = await prisma.payment.create({
    data: {
      walletId,
      zoneId,
      pointId,
      connectorId,
      startedAt: new Date("2026-03-04T09:30:00Z"),
      endedAt: new Date("2026-03-04T10:00:00Z"),
      requestedKwh: new Prisma.Decimal(20),
      kwhFromBalance: new Prisma.Decimal(20),
      amountFiat: new Prisma.Decimal(6),
      status: PaymentStatus.CAPTURED,
      capturedAt: new Date("2026-03-04T10:00:00Z"),
    },
  });
  const token = await prisma.energyToken.create({
    data: {
      assetId,
      zoneId,
      intervalStart: new Date("2026-03-04T08:00:00Z"),
      amountKwh: new Prisma.Decimal(20),
      status: EnergyTokenStatus.BURNED,
      burnedAt: new Date("2026-03-04T10:00:00Z"),
    },
  });
  return prisma.receipt.create({
    data: {
      ...(await receiptStamp(prisma, new Date("2026-03-04T10:00:00Z"))),
      paymentId: payment.id,
      burnedTokenIds: [token.id],
      totalKwh: new Prisma.Decimal(20),
      totalFiat: new Prisma.Decimal(6),
      currency: "EUR",
      breakdown: { kind: "charge", zone: ZONE } as Prisma.InputJsonValue,
    },
  });
}

describe("readReceiptDocument", () => {
  it("freezes the document on the first read", async () => {
    const receipt = await chargeReceipt();
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).document).toBeNull();

    const doc = await readReceiptDocument(receipt.id);

    expect(doc?.network?.vatNumber).toBe("SK2020123456");
    const stored = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(stored.document).not.toBeNull();
  });

  it("keeps saying what it said when the partner edits their VAT rate", async () => {
    const receipt = await chargeReceipt();
    const asIssued = await readReceiptDocument(receipt.id);
    expect(asIssued?.vat?.ratePct).toBe(20);

    await prisma.operatorAccounting.update({
      where: { operatorId },
      data: { vatRatePct: new Prisma.Decimal(10), legalName: "Renamed s.r.o." },
    });

    const later = await readReceiptDocument(receipt.id);
    expect(later?.vat?.ratePct).toBe(20);
    expect(later?.network?.legalName).toBe("Frozen network s.r.o.");
  });

  it("gives dates back as dates, not as strings", async () => {
    const receipt = await chargeReceipt();
    await readReceiptDocument(receipt.id);

    const doc = await readReceiptDocument(receipt.id);
    expect(doc?.issuedAt).toBeInstanceOf(Date);
    expect(doc?.session?.startedAt).toBeInstanceOf(Date);
    expect(doc?.session?.endedAt?.toISOString()).toBe("2026-03-04T10:00:00.000Z");
  });

  it("reads the frozen copy rather than building a fresh one", async () => {
    const receipt = await chargeReceipt();
    const first = await readReceiptDocument(receipt.id);
    expect(first).not.toBeNull();

    // Nothing but a stored snapshot could answer this.
    const stored = (await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } }))
      .document as Record<string, unknown>;
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { document: { ...stored, taxNote: "frozen on purpose" } as Prisma.InputJsonValue },
    });

    expect((await readReceiptDocument(receipt.id))?.taxNote).toBe("frozen on purpose");
  });

  it("has nothing to say about a receipt that does not exist", async () => {
    expect(await readReceiptDocument("no-such-receipt")).toBeNull();
  });
});
