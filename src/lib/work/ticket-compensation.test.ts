// §51 «Компенсации»: возврат ошибочного списания и подарочные кВт·ч за
// неудобство. Одна проверка — один возврат и один подарок.

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { FeatureClosedError } from "@/lib/exchange/gates";
import { awardAfterCharge } from "@/lib/marketing/campaign-engine";
import {
  TicketCompensationError,
  grantTicketCompensation,
  refundTicketPayment,
} from "./ticket-compensation";

const PREFIX = "test_ticketcomp_";
const ZONE = "TCMP";

let operatorId: string;
let pointId: string;
let zoneId: string;
let reporterId: string;
let supportId: string;
let walletId: string;

async function wipe() {
  await prisma.paymentRefund.deleteMany({
    where: { ticket: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.ticketMessage.deleteMany({
    where: { ticket: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.ticket.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.promoGrant.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.payment.deleteMany({ where: { wallet: { owner: { username: { startsWith: PREFIX } } } } });
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
  reporterId = (
    await prisma.user.create({ data: { username: `${PREFIX}driver`, passwordHash: "x" } })
  ).id;
  supportId = (
    await prisma.user.create({ data: { username: `${PREFIX}support`, passwordHash: "x" } })
  ).id;
  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "Compensation zone", currency: "EUR" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Compensation network" },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Compensation point" },
    })
  ).id;
  walletId = (
    await prisma.wallet.create({
      data: { ownerUserId: reporterId, zoneId, currency: "EUR" },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
});

interface WorldOptions {
  withPayment?: boolean;
  paymentStatus?: "CAPTURED" | "FAILED";
  cardId?: string | null;
  anonymous?: boolean;
}

interface World {
  ticketId: string;
  paymentId: string | null;
}

/** Кошелёк с 50 EUR, зарядка на 12 EUR и заявка о неверном списании. */
async function makeWorld(options: WorldOptions = {}): Promise<World> {
  await prisma.wallet.update({
    where: { id: walletId },
    data: { fiatBalance: new Prisma.Decimal(50), reservedFiat: new Prisma.Decimal(0) },
  });

  let paymentId: string | null = null;
  if (options.withPayment !== false) {
    paymentId = (
      await prisma.payment.create({
        data: {
          walletId,
          zoneId,
          pointId,
          cardId: options.cardId ?? null,
          requestedKwh: new Prisma.Decimal(30),
          amountFiat: new Prisma.Decimal(12),
          status: options.paymentStatus ?? "CAPTURED",
          capturedAt: new Date(),
        },
      })
    ).id;
  }

  const ticketId = (
    await prisma.ticket.create({
      data: {
        operatorId,
        pointId,
        paymentId,
        reporterId: options.anonymous ? null : reporterId,
        problemType: "WRONG_PRICE",
        respondBy: new Date(Date.now() + 8 * 60 * 60 * 1000),
      },
    })
  ).id;

  return { ticketId, paymentId };
}

beforeEach(async () => {
  await prisma.paymentRefund.deleteMany({ where: { ticket: { operatorId } } });
  await prisma.ticketMessage.deleteMany({ where: { ticket: { operatorId } } });
  await prisma.ticket.deleteMany({ where: { operatorId } });
  await prisma.promoGrant.deleteMany({ where: { userId: reporterId } });
  await prisma.campaign.deleteMany({ where: { operatorId } });
  await prisma.payment.deleteMany({ where: { walletId } });
});

describe("refundTicketPayment", () => {
  it("credits the wallet, stamps the ticket and says so in the conversation", async () => {
    const world = await makeWorld();
    const refund = await refundTicketPayment({
      ticketId: world.ticketId,
      supportUserId: supportId,
      amountFiat: 4.2,
      reason: "The tariff was wrong",
    });

    expect(refund.amountFiat).toBe(4.2);
    expect(refund.number).toMatch(/^PW-\d{4}-\d{6}$/);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(num(wallet.fiatBalance)).toBe(54.2);

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: world.ticketId } });
    expect(ticket.compensation).toContain("4.20 EUR");

    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId: world.ticketId },
    });
    expect(
      messages.some((m) => m.authorKind === "SYSTEM" && m.body.includes("4.20")),
    ).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { entity: "PaymentRefund", entityId: refund.id },
    });
    expect(audit?.action).toBe("payment.refunded");
  });

  it("refuses a second refund on the same review", async () => {
    const world = await makeWorld();
    await refundTicketPayment({
      ticketId: world.ticketId,
      supportUserId: supportId,
      amountFiat: 1,
      reason: "first",
    });
    await expect(
      refundTicketPayment({
        ticketId: world.ticketId,
        supportUserId: supportId,
        amountFiat: 1,
        reason: "second",
      }),
    ).rejects.toThrow(TicketCompensationError);
  });

  it("two simultaneous clicks produce one refund", async () => {
    const world = await makeWorld();
    const results = await Promise.allSettled([
      refundTicketPayment({
        ticketId: world.ticketId,
        supportUserId: supportId,
        amountFiat: 3,
        reason: "a",
      }),
      refundTicketPayment({
        ticketId: world.ticketId,
        supportUserId: supportId,
        amountFiat: 3,
        reason: "b",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const rows = await prisma.paymentRefund.findMany({
      where: { paymentId: world.paymentId! },
    });
    expect(rows).toHaveLength(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(num(wallet.fiatBalance)).toBe(53);
  });

  it("refuses more than the session cost", async () => {
    const world = await makeWorld();
    await expect(
      refundTicketPayment({
        ticketId: world.ticketId,
        supportUserId: supportId,
        amountFiat: 12.01,
        reason: "everything and more",
      }),
    ).rejects.toThrow(/more than/i);
  });

  it("refuses a ticket that names no session", async () => {
    const world = await makeWorld({ withPayment: false });
    await expect(
      refundTicketPayment({
        ticketId: world.ticketId,
        supportUserId: supportId,
        amountFiat: 1,
        reason: "x",
      }),
    ).rejects.toThrow(/no session/i);
  });

  it("refuses a session that was not captured", async () => {
    const world = await makeWorld({ paymentStatus: "FAILED" });
    await expect(
      refundTicketPayment({
        ticketId: world.ticketId,
        supportUserId: supportId,
        amountFiat: 1,
        reason: "x",
      }),
    ).rejects.toThrow(/was not charged/i);
  });

  it("refuses a card session until the payment provider exists", async () => {
    const world = await makeWorld({ cardId: "card_1" });
    await expect(
      refundTicketPayment({
        ticketId: world.ticketId,
        supportUserId: supportId,
        amountFiat: 1,
        reason: "x",
      }),
    ).rejects.toThrow(FeatureClosedError);
  });

  it("refuses a refund with no reason", async () => {
    const world = await makeWorld();
    await expect(
      refundTicketPayment({
        ticketId: world.ticketId,
        supportUserId: supportId,
        amountFiat: 1,
        reason: "   ",
      }),
    ).rejects.toThrow(/reason/i);
  });
});

/** Кампания-компенсация сети: 5 кВт·ч за неудобство, бюджет 100. */
async function makeCompensationCampaign(over: { budgetKwh?: number } = {}) {
  return prisma.campaign.create({
    data: {
      operatorId,
      zoneId,
      name: "Sorry about that",
      trigger: "COMPENSATION",
      giftKwh: new Prisma.Decimal(5),
      budgetKwh: new Prisma.Decimal(over.budgetKwh ?? 100),
      validityDays: 30,
      oncePerClient: false,
      status: "ACTIVE",
    },
  });
}

describe("grantTicketCompensation", () => {
  it("hands out what the partner configured, once per review", async () => {
    const world = await makeWorld();
    await makeCompensationCampaign();

    const first = await grantTicketCompensation(world.ticketId, supportId);
    expect(first.amountKwh).toBe(5);

    const grants = await prisma.promoGrant.findMany({ where: { userId: reporterId } });
    expect(grants).toHaveLength(1);
    expect(grants[0].onceKey).toBe(`ticket-${world.ticketId}`);

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: world.ticketId } });
    expect(ticket.compensation).toContain("5.000 kWh");

    await expect(grantTicketCompensation(world.ticketId, supportId)).rejects.toThrow(
      TicketCompensationError,
    );
  });

  it("two simultaneous clicks hand out one gift", async () => {
    const world = await makeWorld();
    await makeCompensationCampaign();

    const results = await Promise.allSettled([
      grantTicketCompensation(world.ticketId, supportId),
      grantTicketCompensation(world.ticketId, supportId),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const grants = await prisma.promoGrant.findMany({ where: { userId: reporterId } });
    expect(grants).toHaveLength(1);
  });

  it("refuses when the network configured no compensation", async () => {
    const world = await makeWorld();
    await expect(grantTicketCompensation(world.ticketId, supportId)).rejects.toThrow(
      /has not configured/i,
    );
  });

  it("refuses an anonymous report: a gift belongs to somebody", async () => {
    const world = await makeWorld({ anonymous: true });
    await makeCompensationCampaign();
    await expect(grantTicketCompensation(world.ticketId, supportId)).rejects.toThrow(
      /nobody/i,
    );
  });

  it("refuses when the compensation budget is spent", async () => {
    const world = await makeWorld();
    await makeCompensationCampaign({ budgetKwh: 2 });
    await expect(grantTicketCompensation(world.ticketId, supportId)).rejects.toThrow(
      /budget/i,
    );
  });

  it("a charge earns no compensation gift", async () => {
    const world = await makeWorld();
    const campaign = await makeCompensationCampaign();

    const ids = await awardAfterCharge(world.paymentId!);
    expect(ids).toHaveLength(0);

    const grants = await prisma.promoGrant.findMany({ where: { campaignId: campaign.id } });
    expect(grants).toHaveLength(0);
  });
});
