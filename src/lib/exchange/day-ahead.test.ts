// US-06 — "лимитные заявки на покупку на интервал вперёд" (ТЗ §12, §6).
//
// Three things the story stands on: the trader can see which intervals are on
// offer, money is reserved against an order placed for one of them, and the
// order can be withdrawn right up to the moment its interval starts — and not
// a second later.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "./decimal";
import { cancelOrder, placeOrder, readIntervalLadder, OrderRejected } from "./order-service";
import { getOrCreateWallet } from "./wallet-service";
import { intervalStartFor, upcomingIntervals } from "./zone-service";

const PREFIX = "test_dayahead_";
const ZONE_CODE = "TESTDAYAHEAD";

let zoneId: string;
let buyerUserId: string;
let otherUserId: string;

async function seedUser(username: string) {
  const user = await prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: "x" },
  });
  return user.id;
}

async function wipe() {
  const zone = await prisma.gridZone.findUnique({ where: { code: ZONE_CODE } });
  if (!zone) return;
  await prisma.trade.deleteMany({ where: { zoneId: zone.id } });
  await prisma.order.deleteMany({ where: { zoneId: zone.id } });
  await prisma.energyToken.deleteMany({ where: { zoneId: zone.id } });
  await prisma.wallet.deleteMany({ where: { zoneId: zone.id } });
  await prisma.gridZone.delete({ where: { id: zone.id } });
}

beforeAll(async () => {
  await wipe();
  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "Day-ahead test zone",
      currency: "EUR",
      intervalMinutes: 15,
      corridorPct: new Prisma.Decimal(50),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });
  zoneId = zone.id;
  buyerUserId = await seedUser(`${PREFIX}buyer`);
  otherUserId = await seedUser(`${PREFIX}other`);

  for (const userId of [buyerUserId, otherUserId]) {
    const wallet = await getOrCreateWallet(userId, zoneId);
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { fiatBalance: new Prisma.Decimal(500) },
    });
  }
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("upcomingIntervals — which intervals are on offer (§16.3, §18)", () => {
  it("starts at the interval that `from` falls into and steps by the zone's length", () => {
    const from = new Date("2026-11-24T10:07:30.000Z");
    const list = upcomingIntervals(from, 15, 4);
    expect(list.map((d) => d.toISOString())).toEqual([
      "2026-11-24T10:00:00.000Z",
      "2026-11-24T10:15:00.000Z",
      "2026-11-24T10:30:00.000Z",
      "2026-11-24T10:45:00.000Z",
    ]);
  });

  it("crosses the hour and the day without arithmetic of its own", () => {
    const list = upcomingIntervals(new Date("2026-11-24T23:30:00.000Z"), 60, 3);
    expect(list.map((d) => d.toISOString())).toEqual([
      "2026-11-24T23:00:00.000Z",
      "2026-11-25T00:00:00.000Z",
      "2026-11-25T01:00:00.000Z",
    ]);
  });

  it("asks for nothing and gets nothing", () => {
    expect(upcomingIntervals(new Date(), 15, 0)).toEqual([]);
  });
});

describe("readIntervalLadder — the strip above the book (§6, §9)", () => {
  it("gives best bid, best ask and the trader's own open volume per interval", async () => {
    const base = intervalStartFor(new Date(Date.now() + 2 * 3_600_000), 15);
    const [i0, i1, i2] = upcomingIntervals(base, 15, 3);

    // Mine: a bid on i0 and another on i1.
    await placeOrder({
      userId: buyerUserId,
      zoneId,
      side: "BUY",
      type: "LIMIT",
      amountKwh: 4,
      limitPrice: 0.19,
      intervalStart: i0,
      idempotencyKey: `${PREFIX}l1`,
    });
    await placeOrder({
      userId: buyerUserId,
      zoneId,
      side: "BUY",
      type: "LIMIT",
      amountKwh: 2.5,
      limitPrice: 0.18,
      intervalStart: i1,
      idempotencyKey: `${PREFIX}l2`,
    });
    // Somebody else's: a better bid on i0 and an ask on i0.
    await placeOrder({
      userId: otherUserId,
      zoneId,
      side: "BUY",
      type: "LIMIT",
      amountKwh: 1,
      limitPrice: 0.21,
      intervalStart: i0,
      idempotencyKey: `${PREFIX}l3`,
    });
    await prisma.order.create({
      data: {
        walletId: (await getOrCreateWallet(otherUserId, zoneId)).id,
        zoneId,
        side: "SELL",
        type: "LIMIT",
        intervalStart: i0,
        amountKwh: new Prisma.Decimal(3),
        limitPrice: new Prisma.Decimal(0.25),
      },
    });

    const ladder = await readIntervalLadder(zoneId, [i0, i1, i2], buyerUserId);

    expect(ladder).toHaveLength(3);
    expect(ladder[0].intervalStart.toISOString()).toBe(i0.toISOString());
    expect(ladder[0].bestBid).toBe(0.21);
    expect(ladder[0].bestAsk).toBe(0.25);
    expect(ladder[0].myOpenKwh).toBe(4);

    expect(ladder[1].bestBid).toBe(0.18);
    expect(ladder[1].bestAsk).toBeNull();
    expect(ladder[1].myOpenKwh).toBe(2.5);

    // Nothing on offer for i2, and the row still exists so the strip is even.
    expect(ladder[2].bestBid).toBeNull();
    expect(ladder[2].bestAsk).toBeNull();
    expect(ladder[2].myOpenKwh).toBe(0);
  });

  it("counts only what is still open, and only the asker's own orders", async () => {
    const i = intervalStartFor(new Date(Date.now() + 5 * 3_600_000), 15);
    const placed = await placeOrder({
      userId: buyerUserId,
      zoneId,
      side: "BUY",
      type: "LIMIT",
      amountKwh: 6,
      limitPrice: 0.17,
      intervalStart: i,
      idempotencyKey: `${PREFIX}l4`,
    });

    await cancelOrder(placed.orderId, buyerUserId);

    const mine = await readIntervalLadder(zoneId, [i], buyerUserId);
    expect(mine[0].myOpenKwh).toBe(0);
    expect(mine[0].bestBid).toBeNull();

    const theirs = await readIntervalLadder(zoneId, [i], otherUserId);
    expect(theirs[0].myOpenKwh).toBe(0);
  });
});

describe("a limit buy for an interval ahead (§12 US-06)", () => {
  it("reserves the money the order could spend, and releases it on withdrawal", async () => {
    const i = intervalStartFor(new Date(Date.now() + 3 * 3_600_000), 15);
    const before = await getOrCreateWallet(buyerUserId, zoneId);
    const reservedBefore = num(before.reservedFiat);

    const placed = await placeOrder({
      userId: buyerUserId,
      zoneId,
      side: "BUY",
      type: "LIMIT",
      amountKwh: 10,
      limitPrice: 0.2,
      intervalStart: i,
      idempotencyKey: `${PREFIX}reserve`,
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    expect(order.status).toBe("NEW");
    expect(order.intervalStart?.toISOString()).toBe(i.toISOString());
    expect(num(order.reservedFiat)).toBeGreaterThan(0);

    const held = await prisma.wallet.findUniqueOrThrow({ where: { id: before.id } });
    expect(num(held.reservedFiat)).toBe(reservedBefore + num(order.reservedFiat));

    await cancelOrder(placed.orderId, buyerUserId);

    const freed = await prisma.wallet.findUniqueOrThrow({ where: { id: before.id } });
    expect(num(freed.reservedFiat)).toBe(reservedBefore);
    const cancelled = await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(num(cancelled.reservedFiat)).toBe(0);
  });

  it("refuses to withdraw once the delivery interval has started, and keeps the reserve", async () => {
    // Placed for an interval that is already running: the worker expires it
    // within five minutes, and until then it must not be cancellable.
    const started = intervalStartFor(new Date(Date.now() - 60 * 60 * 1000), 15);
    const wallet = await getOrCreateWallet(buyerUserId, zoneId);
    const order = await prisma.order.create({
      data: {
        walletId: wallet.id,
        zoneId,
        side: "BUY",
        type: "LIMIT",
        intervalStart: started,
        amountKwh: new Prisma.Decimal(5),
        limitPrice: new Prisma.Decimal(0.2),
        reservedFiat: new Prisma.Decimal(1.05),
      },
    });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { reservedFiat: { increment: new Prisma.Decimal(1.05) } },
    });
    const heldBefore = num(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).reservedFiat,
    );

    await expect(cancelOrder(order.id, buyerUserId)).rejects.toThrow(OrderRejected);

    const still = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(still.status).toBe("NEW");
    expect(num(still.reservedFiat)).toBe(1.05);
    const heldAfter = num(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).reservedFiat,
    );
    expect(heldAfter).toBe(heldBefore);
  });

  it("still withdraws a spot order, which belongs to no interval", async () => {
    const placed = await placeOrder({
      userId: buyerUserId,
      zoneId,
      side: "BUY",
      type: "LIMIT",
      amountKwh: 1,
      limitPrice: 0.15,
      intervalStart: null,
      idempotencyKey: `${PREFIX}spot`,
    });
    await cancelOrder(placed.orderId, buyerUserId);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    expect(o.status).toBe("CANCELLED");
  });
});
