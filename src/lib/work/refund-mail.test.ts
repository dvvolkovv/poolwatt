// §51 — водитель узнаёт о возврате. Проход воркера, а не письмо из
// транзакции возврата: транзакция двигает деньги, и упавшая почта не должна
// ронять возврат.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyPendingRefunds } from "./refund-mail";

const PREFIX = "test_refmail_";
const ZONE = "TREFM";

let operatorId: string;
let pointId: string;
let zoneId: string;
let loudWalletId: string;
let silentWalletId: string;
let supportId: string;
let loudEmail: string;

async function wipe() {
  await prisma.paymentRefund.deleteMany({
    where: { ticket: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.ticket.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.payment.deleteMany({
    where: { wallet: { owner: { username: { startsWith: PREFIX } } } },
  });
  await prisma.wallet.deleteMany({ where: { owner: { username: { startsWith: PREFIX } } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

beforeAll(async () => {
  await wipe();
  loudEmail = `${PREFIX}driver@example.test`;
  const loud = await prisma.user.create({
    data: {
      username: `${PREFIX}driver`,
      passwordHash: "x",
      email: loudEmail,
      emailVerified: new Date(),
    },
  });
  const silent = await prisma.user.create({
    data: { username: `${PREFIX}silent`, passwordHash: "x" },
  });
  supportId = (
    await prisma.user.create({ data: { username: `${PREFIX}support`, passwordHash: "x" } })
  ).id;
  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "Refund mail zone", currency: "EUR" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Refund network" },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Refund point", city: "Košice" },
    })
  ).id;
  loudWalletId = (
    await prisma.wallet.create({ data: { ownerUserId: loud.id, zoneId, currency: "EUR" } })
  ).id;
  silentWalletId = (
    await prisma.wallet.create({ data: { ownerUserId: silent.id, zoneId, currency: "EUR" } })
  ).id;
});

afterAll(async () => {
  await wipe();
});

beforeEach(async () => {
  await prisma.paymentRefund.deleteMany({ where: { ticket: { operatorId } } });
  await prisma.ticket.deleteMany({ where: { operatorId } });
  await prisma.payment.deleteMany({
    where: { walletId: { in: [loudWalletId, silentWalletId] } },
  });
});

async function seedRefund(walletId: string) {
  const payment = await prisma.payment.create({
    data: {
      walletId,
      zoneId,
      pointId,
      requestedKwh: new Prisma.Decimal(20),
      amountFiat: new Prisma.Decimal(8),
      status: "CAPTURED",
      capturedAt: new Date(),
    },
  });
  const ticket = await prisma.ticket.create({
    data: {
      operatorId,
      pointId,
      paymentId: payment.id,
      problemType: "WRONG_PRICE",
    },
  });
  return prisma.paymentRefund.create({
    data: {
      paymentId: payment.id,
      ticketId: ticket.id,
      walletId,
      number: `PW-2026-${Math.floor(Math.random() * 900000 + 100000)}`,
      amountFiat: new Prisma.Decimal(4.2),
      currency: "EUR",
      reason: "wrong tariff",
      decidedById: supportId,
    },
  });
}

describe("notifyPendingRefunds", () => {
  it("tells the driver once, with the money and the document number", async () => {
    const refund = await seedRefund(loudWalletId);
    const sent: { to: string; html: string }[] = [];

    const told = await notifyPendingRefunds(new Date(), {
      sendTo: async (to, _subject, html) => {
        sent.push({ to, html });
      },
    });
    expect(told).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(loudEmail);
    expect(sent[0].html).toContain("4.20");
    expect(sent[0].html).toContain(refund.number);

    // Проход идёт каждую минуту: второй раз письма быть не должно.
    expect(await notifyPendingRefunds(new Date(), { sendTo: async () => {} })).toBe(0);
  });

  it("marks a refund told even when nobody can be written to", async () => {
    const refund = await seedRefund(silentWalletId);
    const sent: string[] = [];

    const told = await notifyPendingRefunds(new Date(), {
      sendTo: async (to) => {
        sent.push(to);
      },
    });
    expect(told).toBe(1);
    expect(sent).toHaveLength(0);

    const row = await prisma.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(row.notifiedAt).not.toBeNull();
  });
});
