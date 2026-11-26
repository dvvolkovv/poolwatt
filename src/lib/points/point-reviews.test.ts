// §27 «отзывы». Право на отзыв есть у того, кто здесь был: завершённый
// сеанс зарядки или исполненная бронь. Отзыв, не привязанный ни к одному
// приезду, — это способ испортить чужую карточку, а приезд уже в базе.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { mayReview, readMyReview, readReviews, saveReview } from "./point-reviews";

const SLUG = "test_reviews_net";
const ZONE = "TESTREVIEWS";
const PREFIX = "test_review_";

let pointId: string;
let connectorId: string;
let zoneId: string;
let walletId: string;
let driverId: string;
let strangerId: string;
let bookerId: string;

async function wipe() {
  await prisma.chargeSession.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.reservation.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.pointReview.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();

  const driver = await prisma.user.create({
    data: { username: `${PREFIX}driver`, name: "Jozef Driver", passwordHash: "x" },
  });
  driverId = driver.id;
  const stranger = await prisma.user.create({
    data: { username: `${PREFIX}stranger`, passwordHash: "x" },
  });
  strangerId = stranger.id;
  const booker = await prisma.user.create({
    data: { username: `${PREFIX}booker`, passwordHash: "x" },
  });
  bookerId = booker.id;

  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "Review test zone", currency: "EUR" },
  });
  zoneId = zone.id;
  const wallet = await prisma.wallet.create({
    data: { ownerUserId: driverId, zoneId, currency: "EUR" },
  });
  walletId = wallet.id;

  const operator = await prisma.chargerOperator.create({
    data: { slug: SLUG, displayName: "Review test net" },
  });
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "CHARGING_STATION",
      name: "Review depot",
      status: "DRAFT",
      country: "SK",
      latitude: 50.41,
      longitude: 22.51,
      paymentMethods: ["TOKEN"],
      connectors: { create: [{ type: "CCS2", powerKw: 150, quantity: 1, status: "FREE" }] },
    },
    include: { connectors: true },
  });
  pointId = point.id;
  connectorId = point.connectors[0].id;

  // Водитель здесь зарядился; его бронь никому не нужна.
  await prisma.chargeSession.create({
    data: {
      userId: driverId,
      pointId,
      connectorId,
      zoneId,
      walletId,
      status: "COMPLETED",
      plannedKwh: 10,
      deliveredKwh: 10,
    },
  });
  // Второй человек здесь не заряжался, но его бронь была исполнена.
  const bookerWallet = await prisma.wallet.create({
    data: { ownerUserId: bookerId, zoneId, currency: "EUR" },
  });
  await prisma.reservation.create({
    data: {
      userId: bookerId,
      pointId,
      connectorId,
      walletId: bookerWallet.id,
      eta: new Date(),
      windowStart: new Date(),
      windowEnd: new Date(Date.now() + 900_000),
      feeFiat: 0,
      guaranteeFiat: 0,
      noShowPenaltyFiat: 0,
      freeCancelMinutes: 30,
      status: "FULFILLED",
      currency: "EUR",
    },
  });
});

beforeEach(async () => {
  await prisma.pointReview.deleteMany({ where: { pointId } });
});

afterAll(async () => {
  await wipe();
});

describe("mayReview", () => {
  it("lets in the driver who finished a session here", async () => {
    expect(await mayReview(driverId, pointId)).toBe(true);
  });

  it("lets in the driver whose booking was fulfilled", async () => {
    expect(await mayReview(bookerId, pointId)).toBe(true);
  });

  it("keeps out somebody who has never been here", async () => {
    expect(await mayReview(strangerId, pointId)).toBe(false);
  });

  it("does not count a session that is still running", async () => {
    const live = await prisma.chargeSession.create({
      data: {
        userId: strangerId,
        pointId,
        connectorId,
        zoneId,
        walletId,
        status: "ACTIVE",
        plannedKwh: 10,
        deliveredKwh: 2,
      },
    });
    expect(await mayReview(strangerId, pointId)).toBe(false);
    await prisma.chargeSession.delete({ where: { id: live.id } });
  });
});

describe("saveReview", () => {
  it("refuses somebody who has never been here", async () => {
    const result = await saveReview({ userId: strangerId, pointId, rating: 5, text: "ok" });
    expect(result).toEqual({ ok: false, reason: "no_visit" });
    expect(await prisma.pointReview.count({ where: { pointId } })).toBe(0);
  });

  it("refuses a rating outside one to five", async () => {
    for (const rating of [0, 6, 2.5]) {
      expect(await saveReview({ userId: driverId, pointId, rating, text: null })).toEqual({
        ok: false,
        reason: "bad_rating",
      });
    }
  });

  it("rewrites the author's own review rather than adding a second", async () => {
    await saveReview({ userId: driverId, pointId, rating: 3, text: "fine" });
    await saveReview({ userId: driverId, pointId, rating: 5, text: "better than I thought" });

    const rows = await prisma.pointReview.findMany({ where: { pointId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(5);
    expect(rows[0].text).toBe("better than I thought");
  });

  it("cuts a text nobody will read to the end", async () => {
    await saveReview({ userId: driverId, pointId, rating: 4, text: "x".repeat(1500) });
    const row = await prisma.pointReview.findFirstOrThrow({ where: { pointId } });
    expect(row.text).toHaveLength(1000);
  });

  it("has nothing to write about a point that is not there", async () => {
    expect(
      await saveReview({ userId: driverId, pointId: "no-such-point", rating: 4, text: null }),
    ).toEqual({ ok: false, reason: "no_point" });
  });
});

describe("readReviews", () => {
  it("averages what was left, newest first", async () => {
    await saveReview({ userId: driverId, pointId, rating: 5, text: "great" });
    await saveReview({ userId: bookerId, pointId, rating: 2, text: "cable too short" });

    const view = await readReviews(pointId);
    expect(view.count).toBe(2);
    expect(view.average).toBeCloseTo(3.5, 5);
    expect(view.rows).toHaveLength(2);
    expect(view.rows.map((r) => r.rating).sort()).toEqual([2, 5]);
    // Имя, если есть; иначе ник.
    expect(view.rows.some((r) => r.author === "Jozef Driver")).toBe(true);
    expect(view.rows.some((r) => r.author === `${PREFIX}booker`)).toBe(true);
  });

  it("says nothing instead of zero for a point with no reviews", async () => {
    const view = await readReviews(pointId);
    expect(view).toMatchObject({ average: null, count: 0, rows: [] });
  });
});

describe("readMyReview", () => {
  it("brings back what this person wrote, so the form can show it", async () => {
    await saveReview({ userId: driverId, pointId, rating: 4, text: "solid" });
    expect(await readMyReview(driverId, pointId)).toEqual({ rating: 4, text: "solid" });
  });

  it("is empty for somebody who wrote nothing", async () => {
    expect(await readMyReview(strangerId, pointId)).toBeNull();
  });
});
