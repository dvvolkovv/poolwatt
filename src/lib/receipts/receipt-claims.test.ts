// §46 — the accountant returns a wrong receipt to support, and support either
// issues a corrected version by the regulation or refuses in words.

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
import { inviteEmployee } from "@/lib/staff/staff-service";
import { receiptStamp } from "./receipt-number";
import { ReceiptClaimError, fileReceiptClaim, readClaimQueue } from "./receipt-claims";
import {
  ReceiptCorrectionError,
  correctReceipt,
  readCorrectionJournal,
  receiptInForce,
  rejectClaim,
} from "./receipt-correction";
import { readReceiptDocument } from "./receipt-store";

const PREFIX = "test_rclaim_";
const SLUG = `${PREFIX}net`;
const ZONE = "TESTRCLM";

let operatorId: string;
let pointId: string;
let otherPointId: string;
let connectorId: string;
let zoneId: string;
let ownerId: string;
let accountantId: string;
let narrowAccountantId: string;
let strangerId: string;
let supportId: string;
let walletId: string;
let assetId: string;
let companyId: string;

async function wipe() {
  await prisma.receiptCorrection.deleteMany({
    where: { receipt: { payment: { zone: { code: ZONE } } } },
  });
  await prisma.receiptClaim.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.receipt.deleteMany({ where: { corrects: { payment: { zone: { code: ZONE } } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.asset.deleteMany({ where: { company: { legalName: { startsWith: PREFIX } } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.operatorAccounting.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

async function point(name: string) {
  const p = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: PointType.CHARGING_STATION,
      name,
      status: PointStatus.PUBLISHED,
      country: "SK",
      city: "Košice",
      addressLine: "Hlavná 1",
      gridZoneId: zoneId,
      paymentMethods: [],
      amenities: [],
    },
  });
  return p.id;
}

beforeAll(async () => {
  await wipe();

  const user = async (name: string) =>
    (
      await prisma.user.create({
        data: { username: `${PREFIX}${name}`, passwordHash: "x", email: `${PREFIX}${name}@test.local` },
      })
    ).id;
  ownerId = await user("owner");
  accountantId = await user("acc");
  narrowAccountantId = await user("acc2");
  strangerId = await user("stranger");
  supportId = await user("support");

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, name: "Claim zone", country: "SK", currency: "EUR" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "Claim network",
        claimedById: ownerId,
        claimedAt: new Date(),
      },
    })
  ).id;
  await prisma.operatorAccounting.create({
    data: {
      operatorId,
      legalName: "Claim network s.r.o.",
      regNumber: "12345678",
      vatNumber: "SK9999999999",
      addressLine: "Hlavná 1",
      city: "Košice",
      country: "SK",
      vatRatePct: new Prisma.Decimal(20),
    },
  });
  pointId = await point("First point");
  otherPointId = await point("Second point");
  connectorId = (
    await prisma.pointConnector.create({
      data: { pointId, type: EvConnectorType.CCS2, powerKw: new Prisma.Decimal(150), quantity: 1 },
    })
  ).id;

  // §47 — one accountant for the whole network, one for the other point only.
  await inviteEmployee({
    operatorId,
    actorUserId: ownerId,
    username: `${PREFIX}acc`,
    roleName: "ACCOUNTANT",
    pointIds: [],
  });
  await inviteEmployee({
    operatorId,
    actorUserId: ownerId,
    username: `${PREFIX}acc2`,
    roleName: "ACCOUNTANT",
    pointIds: [otherPointId],
  });

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
  walletId = (await getOrCreateWallet(ownerId, zoneId)).id;
});

beforeEach(async () => {
  await prisma.receiptCorrection.deleteMany({ where: { claim: { operatorId } } });
  await prisma.receiptClaim.deleteMany({ where: { operatorId } });
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.receipt.deleteMany({ where: { paymentId: null, tradeId: null, reservationId: null } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

async function receiptAt(at = pointId) {
  const payment = await prisma.payment.create({
    data: {
      walletId,
      zoneId,
      pointId: at,
      connectorId: at === pointId ? connectorId : null,
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

describe("fileReceiptClaim — who may return a document", () => {
  it("takes a claim from the network's accountant", async () => {
    const receipt = await receiptAt();

    const claim = await fileReceiptClaim(accountantId, {
      receiptId: receipt.id,
      reason: "VAT",
      comment: "The VAT number is the old one",
    });

    expect(claim.status).toBe("OPEN");
    expect(claim.operatorId).toBe(operatorId);
    const queue = await readClaimQueue("OPEN");
    expect(queue.map((c) => c.receiptId)).toContain(receipt.id);
  });

  it("refuses somebody who does not keep these books", async () => {
    const receipt = await receiptAt();
    await expect(
      fileReceiptClaim(strangerId, {
        receiptId: receipt.id,
        reason: "VAT",
        comment: "I think this is wrong",
      }),
    ).rejects.toThrow(ReceiptClaimError);
  });

  it("refuses a point outside the accountant's scope (§47)", async () => {
    const receipt = await receiptAt();
    await expect(
      fileReceiptClaim(narrowAccountantId, {
        receiptId: receipt.id,
        reason: "VAT",
        comment: "Not my point but let me try",
      }),
    ).rejects.toThrow("not in your scope");
  });

  it("takes the same accountant's claim about their own point", async () => {
    const receipt = await receiptAt(otherPointId);
    const claim = await fileReceiptClaim(narrowAccountantId, {
      receiptId: receipt.id,
      reason: "REQUISITES",
      comment: "Our legal name changed in February",
    });
    expect(claim.id).toBeTruthy();
  });

  it("refuses a comment that says nothing", async () => {
    const receipt = await receiptAt();
    await expect(
      fileReceiptClaim(accountantId, { receiptId: receipt.id, reason: "OTHER", comment: "wrong" }),
    ).rejects.toThrow("Say what is wrong");
  });

  it("keeps one claim per receipt, even from two clicks at once", async () => {
    const receipt = await receiptAt();
    const results = await Promise.allSettled([
      fileReceiptClaim(accountantId, {
        receiptId: receipt.id,
        reason: "VAT",
        comment: "The rate is wrong here",
      }),
      fileReceiptClaim(ownerId, {
        receiptId: receipt.id,
        reason: "VAT",
        comment: "The rate is wrong here",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.receiptClaim.count({ where: { receiptId: receipt.id } })).toBe(1);
  });
});

describe("correctReceipt — the regulation", () => {
  async function openClaim(reason: "VAT" | "REQUISITES" | "AMOUNTS" = "VAT") {
    const receipt = await receiptAt();
    await readReceiptDocument(receipt.id);
    const claim = await fileReceiptClaim(accountantId, {
      receiptId: receipt.id,
      reason,
      comment: "This document is wrong, please fix it",
    });
    return { receipt, claim };
  }

  it("issues a new version instead of editing the old one", async () => {
    const { receipt, claim } = await openClaim("REQUISITES");

    const result = await correctReceipt(supportId, {
      claimId: claim.id,
      changes: [{ field: "network.legalName", after: "Claim network a.s." }],
      note: "Renamed in the company register on 2 February",
    });

    const issued = await prisma.receipt.findUniqueOrThrow({
      where: { id: result.issuedReceiptId },
    });
    expect(issued.correctsReceiptId).toBe(receipt.id);
    expect(issued.number).not.toBe(receipt.number);
    expect(issued.documentVersion).toBe(2);
    // The amounts are what happened, and they are copied, not recomputed.
    expect(Number(issued.totalFiat)).toBe(6);
    expect(Number(issued.totalKwh)).toBe(20);

    // The original still says what it said.
    const original = await readReceiptDocument(receipt.id);
    expect(original?.network?.legalName).toBe("Claim network s.r.o.");
    const corrected = await readReceiptDocument(issued.id);
    expect(corrected?.network?.legalName).toBe("Claim network a.s.");
    expect(corrected?.number).toBe(issued.number);
  });

  it("recomputes the VAT split, and never the sum", async () => {
    const { claim } = await openClaim("VAT");

    const result = await correctReceipt(supportId, {
      claimId: claim.id,
      changes: [{ field: "vat.ratePct", after: 10 }],
    });

    const doc = await readReceiptDocument(result.issuedReceiptId);
    expect(doc?.vat?.ratePct).toBe(10);
    expect(doc?.vat?.gross).toBe(6);
    // 6.00 gross at 10 % inclusive is 5.45 net and 0.55 tax.
    expect(doc?.vat?.net).toBe(5.45);
    expect(doc?.vat?.amount).toBe(0.55);
  });

  it("refuses a field the regulation does not allow", async () => {
    const { claim } = await openClaim();
    await expect(
      correctReceipt(supportId, {
        claimId: claim.id,
        changes: [{ field: "totalFiat", after: 1 }],
      }),
    ).rejects.toThrow("cannot be corrected");
  });

  it("refuses a claim about the amount, naming the reason", async () => {
    const { claim } = await openClaim("AMOUNTS");
    await expect(
      correctReceipt(supportId, {
        claimId: claim.id,
        changes: [{ field: "network.legalName", after: "Anything" }],
      }),
    ).rejects.toThrow("payment provider");
  });

  it("writes the journal field by field", async () => {
    const { receipt, claim } = await openClaim("REQUISITES");
    await correctReceipt(supportId, {
      claimId: claim.id,
      changes: [
        { field: "network.vatNumber", after: "SK1111111111" },
        { field: "network.regNumber", after: "87654321" },
      ],
      note: "Both numbers were the predecessor's",
    });

    const journal = await readCorrectionJournal(receipt.id);
    expect(journal).toHaveLength(1);
    expect(journal[0].by).toBe(`${PREFIX}support`);
    expect(journal[0].changes).toEqual([
      { field: "network.vatNumber", before: "SK9999999999", after: "SK1111111111" },
      { field: "network.regNumber", before: "12345678", after: "87654321" },
    ]);
    // The same journal is visible from the new version.
    const fromNewVersion = await readCorrectionJournal(journal[0].toReceiptId);
    expect(fromNewVersion).toHaveLength(1);
  });

  it("gives one version, not two, when support clicks twice", async () => {
    const { claim } = await openClaim("REQUISITES");

    const results = await Promise.allSettled([
      correctReceipt(supportId, {
        claimId: claim.id,
        changes: [{ field: "network.legalName", after: "First try a.s." }],
      }),
      correctReceipt(supportId, {
        claimId: claim.id,
        changes: [{ field: "network.legalName", after: "Second try a.s." }],
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.receiptCorrection.count({ where: { claimId: claim.id } })).toBe(1);
  });

  it("refuses a correction that changes nothing", async () => {
    const { claim } = await openClaim("REQUISITES");
    await expect(
      correctReceipt(supportId, {
        claimId: claim.id,
        changes: [{ field: "network.legalName", after: "Claim network s.r.o." }],
      }),
    ).rejects.toThrow("already say that");
  });

  it("points at the version in force", async () => {
    const { receipt, claim } = await openClaim("REQUISITES");
    const result = await correctReceipt(supportId, {
      claimId: claim.id,
      changes: [{ field: "network.legalName", after: "In force a.s." }],
    });

    const force = await receiptInForce(receipt.id);
    expect(force.id).toBe(result.issuedReceiptId);
  });

  it("lets the accountant file a second claim once the first is answered", async () => {
    const { receipt, claim } = await openClaim("REQUISITES");
    await correctReceipt(supportId, {
      claimId: claim.id,
      changes: [{ field: "network.legalName", after: "Once more a.s." }],
    });

    const second = await fileReceiptClaim(accountantId, {
      receiptId: receipt.id,
      reason: "OTHER",
      comment: "Still something off about this one",
    });
    expect(second.status).toBe("OPEN");
  });
});

describe("rejectClaim", () => {
  it("refuses in words, and the claim closes", async () => {
    const receipt = await receiptAt();
    const claim = await fileReceiptClaim(accountantId, {
      receiptId: receipt.id,
      reason: "AMOUNTS",
      comment: "The driver says they were charged twice",
    });

    await rejectClaim(
      supportId,
      claim.id,
      "A refund needs the payment provider; the document itself is right",
    );

    const after = await prisma.receiptClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(after.status).toBe("REJECTED");
    expect(after.resolution).toContain("payment provider");
    expect(after.openKey).toBeNull();
  });

  it("will not refuse without saying why", async () => {
    const receipt = await receiptAt();
    const claim = await fileReceiptClaim(accountantId, {
      receiptId: receipt.id,
      reason: "OTHER",
      comment: "Something is wrong with this",
    });
    await expect(rejectClaim(supportId, claim.id, "no")).rejects.toThrow(ReceiptCorrectionError);
  });
});

describe("who may open a corrected version", () => {
  it("lets the person the original belonged to open it", async () => {
    const receipt = await receiptAt();
    await readReceiptDocument(receipt.id);
    const claim = await fileReceiptClaim(accountantId, {
      receiptId: receipt.id,
      reason: "REQUISITES",
      comment: "The legal name on this one is wrong",
    });
    const { issuedReceiptId } = await correctReceipt(supportId, {
      claimId: claim.id,
      changes: [{ field: "network.legalName", after: "Owner can read a.s." }],
    });

    // The wallet behind the original belongs to the owner in these fixtures.
    const { readReceiptForUser } = await import("@/lib/exchange/payment-service");
    expect(await readReceiptForUser(issuedReceiptId, ownerId, false)).not.toBeNull();
    expect(await readReceiptForUser(issuedReceiptId, strangerId, false)).toBeNull();
  });
});
