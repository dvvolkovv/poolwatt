// §28 «Карточка пункта: поля». Один читатель — каждое поле таблицы §28
// должно из него выйти, иначе карточка снова начнёт недоговаривать.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { readPointCard } from "./point-card";

const SLUG = "test_card_net";
const ZONE = "TESTCARD";
const PREFIX = "test_card_";

let ownerId: string;
let outsiderId: string;
let pointId: string;
let closedPointId: string;
let coopOnlyId: string;

// Полдень в Братиславе: 11:00 UTC зимой.
const NOON = new Date("2026-01-15T11:00:00.000Z");

async function wipe() {
  await prisma.pointPhoto.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();

  ownerId = (
    await prisma.user.create({ data: { username: `${PREFIX}owner`, passwordHash: "x" } })
  ).id;
  outsiderId = (
    await prisma.user.create({ data: { username: `${PREFIX}outsider`, passwordHash: "x" } })
  ).id;

  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "Card test zone", currency: "EUR" },
  });

  const operator = await prisma.chargerOperator.create({
    data: {
      slug: SLUG,
      displayName: "Card test net",
      description: "A network that fills in its card",
      websiteUrl: "https://example.test",
      email: "hello@example.test",
      phone: "+421900000000",
      claimedById: ownerId,
      claimedAt: new Date(),
      accounting: { create: { legalName: "Card test net s.r.o.", vatNumber: "SK1234567890" } },
    },
  });

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "MIXED",
      name: "Card depot",
      status: "PUBLISHED",
      visibility: "PUBLIC",
      country: "SK",
      city: "Bratislava",
      addressLine: "Kartová 1",
      latitude: 50.71,
      longitude: 22.81,
      gridZoneId: zone.id,
      howToFind: "level -2, behind the lift",
      energySource: "WIND",
      goCertificateRef: "GO-2026-0001",
      storageKwh: 120,
      open24: false,
      openHours: [
        { from: "08:00", to: "20:00" },
        { from: "08:00", to: "20:00" },
        { from: "08:00", to: "20:00" },
        { from: "08:00", to: "20:00" },
        { from: "08:00", to: "20:00" },
        { from: "10:00", to: "16:00" },
        null,
      ],
      holidayNote: "Closed on 1 January",
      paymentMethods: ["TOKEN", "WHITE_LABEL_CARD", "QR"],
      amenities: ["PARKING", "CAFE", "ACCESSIBLE"],
      ocppVersion: "2.0.1",
      meterId: "METER-1",
      logoUrl: "https://example.test/logo.svg",
      pinColor: "#10b981",
      description: "Mixed site: a powerbank and two chargers",
      publishedAt: new Date(),
      lastSeenAt: new Date(),
      connectors: {
        create: [
          { type: "CCS2", powerKw: 150, quantity: 2, currentAc: false, status: "FREE" },
          { type: "SCHUKO", powerKw: 3.7, quantity: 1, status: "BUSY" },
        ],
      },
      tariffs: {
        create: [
          {
            label: "day",
            fromMinute: 360,
            toMinute: 1320,
            priceFiat: 0.4,
            priceTokens: 1.1,
            currency: "EUR",
            idleFeePerMin: 0.05,
            coopDiscount: 10,
          },
          {
            label: "night",
            fromMinute: 1320,
            toMinute: 360,
            priceFiat: 0.15,
            currency: "EUR",
          },
        ],
      },
      policy: { create: { enabled: true, feeFiat: 1, guaranteeFiat: 5, noShowPenaltyFiat: 3 } },
    },
  });
  pointId = point.id;

  await prisma.pointPhoto.create({
    data: {
      pointId,
      storageKey: "deadbeefdeadbeefdeadbeef",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      position: 0,
    },
  });

  const closed = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "CHARGING_STATION",
      name: "Temporarily closed depot",
      status: "PUBLISHED",
      visibility: "PUBLIC",
      country: "SK",
      latitude: 50.72,
      longitude: 22.82,
      paymentMethods: ["TOKEN"],
      publishedAt: new Date(),
      closedFrom: new Date("2026-01-10T00:00:00.000Z"),
      closedUntil: new Date("2026-02-10T00:00:00.000Z"),
    },
  });
  closedPointId = closed.id;

  const coopOnly = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "POWERBANK",
      name: "Members depot",
      status: "PUBLISHED",
      visibility: "COOP_MEMBERS",
      country: "SK",
      latitude: 50.73,
      longitude: 22.83,
      paymentMethods: ["TOKEN"],
      publishedAt: new Date(),
    },
  });
  coopOnlyId = coopOnly.id;
});

afterAll(async () => {
  await wipe();
});

describe("readPointCard — every block of §28", () => {
  it("brings the owner with its contacts and tax details", async () => {
    const card = await readPointCard(pointId, null, NOON);
    expect(card?.owner).toMatchObject({
      displayName: "Card test net",
      websiteUrl: "https://example.test",
      email: "hello@example.test",
      phone: "+421900000000",
      verified: true,
      legalName: "Card test net s.r.o.",
      vatNumber: "SK1234567890",
    });
  });

  it("brings the type, the address, the zone and how to find it", async () => {
    const card = await readPointCard(pointId, null, NOON);
    expect(card?.type).toBe("MIXED");
    expect(card?.city).toBe("Bratislava");
    expect(card?.addressLine).toBe("Kartová 1");
    expect(card?.gridZoneCode).toBe(ZONE);
    expect(card?.howToFind).toBe("level -2, behind the lift");
  });

  it("brings the energy source with its guarantee of origin", async () => {
    const card = await readPointCard(pointId, null, NOON);
    expect(card?.energySource).toBe("WIND");
    expect(card?.goCertificateRef).toBe("GO-2026-0001");
    expect(card?.green).toBe(true);
  });

  it("brings the equipment: connectors, how many, and the storage", async () => {
    const card = await readPointCard(pointId, null, NOON);
    expect(card?.connectors).toHaveLength(2);
    expect(card?.connectors[0]).toMatchObject({ type: "CCS2", powerKw: 150, quantity: 2 });
    expect(card?.totalPoints).toBe(3);
    expect(card?.maxPowerKw).toBe(150);
    expect(card?.storageKwh).toBe(120);
  });

  it("brings every tariff window and marks the one in force", async () => {
    const card = await readPointCard(pointId, null, NOON);
    expect(card?.tariffs).toHaveLength(2);
    const inForce = card?.tariffs.filter((t) => t.inForce);
    expect(inForce).toHaveLength(1);
    expect(inForce?.[0].label).toBe("day");
    expect(card?.priceNow).toMatchObject({ fiat: 0.4, tokens: 1.1, currency: "EUR" });
    expect(card?.tariffs[0].idleFeePerMin).toBe(0.05);
    expect(card?.tariffs[0].coopDiscount).toBe(10);
    expect(card?.priceZoneKnown).toBe(true);
  });

  it("picks the night window at night", async () => {
    // 22:30 в Братиславе.
    const card = await readPointCard(pointId, null, new Date("2026-01-15T21:30:00.000Z"));
    expect(card?.priceNow?.fiat).toBe(0.15);
  });

  it("brings the opening hours by weekday, the holidays and the closure", async () => {
    const card = await readPointCard(pointId, null, NOON);
    expect(card?.open24).toBe(false);
    expect(card?.openHours).toHaveLength(7);
    expect(card?.openHours?.[0]).toEqual({ from: "08:00", to: "20:00" });
    expect(card?.openHours?.[6]).toBeNull();
    expect(card?.holidayNote).toBe("Closed on 1 January");
    expect(card?.closedNow).toBe(false);
  });

  it("says when a point is shut right now", async () => {
    const card = await readPointCard(closedPointId, null, NOON);
    expect(card?.closedNow).toBe(true);
  });

  it("brings the payment methods, the amenities and the connection", async () => {
    const card = await readPointCard(pointId, null, NOON);
    expect(card?.paymentMethods).toEqual(["TOKEN", "WHITE_LABEL_CARD", "QR"]);
    expect(card?.amenities).toEqual(["PARKING", "CAFE", "ACCESSIBLE"]);
    expect(card?.ocppVersion).toBe("2.0.1");
  });

  it("brings the brand and says the point can be booked", async () => {
    const card = await readPointCard(pointId, null, NOON);
    expect(card?.logoUrl).toBe("https://example.test/logo.svg");
    expect(card?.pinColor).toBe("#10b981");
    expect(card?.description).toBe("Mixed site: a powerbank and two chargers");
    expect(card?.bookable).toBe(true);
  });

  it("hands over the photos as addresses, never as bytes", async () => {
    const card = await readPointCard(pointId, null, NOON);
    expect(card?.photos).toHaveLength(1);
    expect(card?.photos[0].url).toBe(
      `/api/v1/points/${pointId}/photos/${card?.photos[0].id}`,
    );
  });

  it("does not keep the meter id in a card a stranger reads", async () => {
    const card = await readPointCard(pointId, null, NOON);
    // §28 «API-ключ телеметрии, ID счётчика» — это поля подключения, они
    // нужны сети, а не водителю; в карточке их нет.
    expect(card && "meterId" in card).toBe(false);
  });
});

describe("readPointCard — who may read it", () => {
  it("has nothing for a point that is not there", async () => {
    expect(await readPointCard("no-such-point", ownerId, NOON)).toBeNull();
  });

  it("hides a members-only card from a stranger and shows it to its network", async () => {
    expect(await readPointCard(coopOnlyId, outsiderId, NOON)).toBeNull();
    expect((await readPointCard(coopOnlyId, ownerId, NOON))?.viewReason).toBe("owner");
  });

  it("says why the card is visible, so the page can mark a closed one", async () => {
    expect((await readPointCard(pointId, null, NOON))?.viewReason).toBe("public");
  });
});
