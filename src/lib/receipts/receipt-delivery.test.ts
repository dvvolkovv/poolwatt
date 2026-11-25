// §46 "Доставка чека" and US-45 — "чек формируется в течение минуты после
// зарядки".
//
// Formation is instant: the receipt is written inside the payment's own
// transaction. Delivery is what the minute is about, so these tests are about
// what the driver chose, what the owner has not supplied yet (push keys), and
// what happens when the mail server is down — because a failed mail must not
// leave the receipt looking delivered.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Prisma, PaymentStatus, PointStatus, PointType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateWallet } from "@/lib/exchange/wallet-service";
import { receiptStamp } from "./receipt-number";
import { deliverReceipt, notifyPendingReceipts } from "./receipt-delivery";

const PREFIX = "test_deliv_";
const SLUG = `${PREFIX}net`;
const ZONE = "TESTDELIV";

let zoneId: string;
let userId: string;
let pointId: string;
let walletId: string;

type Sent = { to: string; subject: string; html: string };

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.operatorAccounting.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  userId = (
    await prisma.user.create({
      data: {
        username: `${PREFIX}driver`,
        passwordHash: "x",
        email: `${PREFIX}driver@example.test`,
        emailVerified: new Date(),
        preferredLocale: "ru",
      },
    })
  ).id;
  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, name: "Delivery", country: "SK", currency: "EUR" },
    })
  ).id;
  const operator = await prisma.chargerOperator.create({
    data: { slug: SLUG, displayName: "Delivery network", logoUrl: "https://example.test/l.png" },
  });
  await prisma.operatorAccounting.create({
    data: { operatorId: operator.id, legalName: "Delivery s.r.o.", vatRatePct: new Prisma.Decimal(20) },
  });
  pointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId: operator.id,
        type: PointType.CHARGING_STATION,
        name: "Delivery point",
        status: PointStatus.PUBLISHED,
        paymentMethods: [],
        amenities: [],
      },
    })
  ).id;
  walletId = (await getOrCreateWallet(userId, zoneId)).id;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.user.update({
    where: { id: userId },
    data: { receiptEmail: true, receiptPush: true },
  });
});

async function makeReceipt() {
  const payment = await prisma.payment.create({
    data: {
      walletId,
      zoneId,
      pointId,
      requestedKwh: new Prisma.Decimal(10),
      kwhFromBalance: new Prisma.Decimal(10),
      amountFiat: new Prisma.Decimal(4.2),
      status: PaymentStatus.CAPTURED,
      capturedAt: new Date(),
    },
  });
  return prisma.receipt.create({
    data: {
      ...(await receiptStamp(prisma)),
      paymentId: payment.id,
      burnedTokenIds: [],
      totalKwh: new Prisma.Decimal(10),
      totalFiat: new Prisma.Decimal(4.2),
      currency: "EUR",
      breakdown: { kind: "charge", kwhFromBalance: 10 } as Prisma.InputJsonValue,
    },
  });
}

function collector() {
  const sent: Sent[] = [];
  return {
    sent,
    sendTo: async (to: string, subject: string, html: string) => {
      sent.push({ to, subject, html });
    },
  };
}

describe("deliverReceipt", () => {
  it("mails the receipt to the driver and records the channel", async () => {
    const receipt = await makeReceipt();
    const box = collector();
    const result = await deliverReceipt(receipt.id, { sendTo: box.sendTo });

    expect(result.channels).toEqual(["email"]);
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0].to).toBe(`${PREFIX}driver@example.test`);

    const after = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(after.deliveredAt).not.toBeNull();
    expect(after.deliveryChannels).toEqual(["email"]);
    expect(after.deliveryError).toBeNull();
  });

  it("puts the network's name and the amount in the letter", async () => {
    const receipt = await makeReceipt();
    const box = collector();
    await deliverReceipt(receipt.id, { sendTo: box.sendTo });
    const mail = box.sent[0];
    expect(mail.html).toContain("Delivery network");
    expect(mail.html).toContain("https://example.test/l.png");
    expect(mail.html).toContain("4.20");
    expect(mail.subject).toContain(receipt.number!);
  });

  it("sends nothing by mail when the driver turned it off", async () => {
    await prisma.user.update({ where: { id: userId }, data: { receiptEmail: false } });
    const receipt = await makeReceipt();
    const box = collector();
    const result = await deliverReceipt(receipt.id, { sendTo: box.sendTo });
    expect(box.sent).toHaveLength(0);
    expect(result.channels).toEqual([]);
    // Settled, not owed: nothing is going to change by retrying.
    const after = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(after.deliveredAt).not.toBeNull();
  });

  it("does not write to an address nobody proved they own", async () => {
    await prisma.user.update({ where: { id: userId }, data: { emailVerified: null } });
    const receipt = await makeReceipt();
    const box = collector();
    const result = await deliverReceipt(receipt.id, { sendTo: box.sendTo });
    expect(result.channels).toEqual([]);
    await prisma.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
  });

  it("leaves the receipt owing when the mail server refuses", async () => {
    const receipt = await makeReceipt();
    const result = await deliverReceipt(receipt.id, {
      sendTo: async () => {
        throw new Error("smtp down");
      },
    });
    expect(result.channels).toEqual([]);
    const after = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(after.deliveredAt).toBeNull();
    expect(after.deliveryError).toContain("smtp down");
  });

  it("never throws into the payment path", async () => {
    await expect(
      deliverReceipt("no_such_receipt", { sendTo: async () => {} }),
    ).resolves.toEqual({ channels: [] });
  });

  it("records push only when the owner has supplied the keys", async () => {
    const receipt = await makeReceipt();
    const closed = await deliverReceipt(receipt.id, { sendTo: async () => {}, pushIsOpen: false });
    expect(closed.channels).toEqual(["email"]);

    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { deliveredAt: null, deliveryChannels: [] },
    });
    const open = await deliverReceipt(receipt.id, { sendTo: async () => {}, pushIsOpen: true });
    expect(open.channels).toEqual(["email", "push"]);
  });

  it("does not deliver the same receipt twice", async () => {
    const receipt = await makeReceipt();
    const box = collector();
    await deliverReceipt(receipt.id, { sendTo: box.sendTo });
    await deliverReceipt(receipt.id, { sendTo: box.sendTo });
    expect(box.sent).toHaveLength(1);
  });
});

describe("notifyPendingReceipts", () => {
  it("picks up what the inline attempt failed to deliver", async () => {
    const receipt = await makeReceipt();
    await deliverReceipt(receipt.id, {
      sendTo: async () => {
        throw new Error("smtp down");
      },
    });

    const box = collector();
    const count = await notifyPendingReceipts({ sendTo: box.sendTo });
    expect(count).toBeGreaterThanOrEqual(1);
    expect(box.sent.some((m) => m.subject.includes(receipt.number!))).toBe(true);

    const after = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(after.deliveredAt).not.toBeNull();
  });

  it("leaves alone what is already delivered", async () => {
    const receipt = await makeReceipt();
    await deliverReceipt(receipt.id, { sendTo: async () => {} });
    const box = collector();
    await notifyPendingReceipts({ sendTo: box.sendTo });
    expect(box.sent).toHaveLength(0);
  });
});

describe("what gets mailed and what only lands in the wallet", () => {
  it("does not mail a receipt for every exchange fill", async () => {
    // A trader filling twenty orders is not asking for twenty letters: the
    // wallet history is the channel §46 calls "кабинет в приложении".
    const receipt = await prisma.receipt.create({
      data: {
        ...(await receiptStamp(prisma)),
        burnedTokenIds: [],
        totalKwh: new Prisma.Decimal(5),
        totalFiat: new Prisma.Decimal(2),
        currency: "EUR",
        breakdown: { kind: "trade", amountKwh: 5, price: 0.4 } as Prisma.InputJsonValue,
      },
    });
    const box = collector();
    const result = await deliverReceipt(receipt.id, { sendTo: box.sendTo });
    expect(box.sent).toHaveLength(0);
    expect(result.channels).toEqual(["wallet"]);
    const after = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(after.deliveredAt).not.toBeNull();
    await prisma.receipt.delete({ where: { id: receipt.id } });
  });
});
