// US-24 — "заполнить карточку через мастер", ТЗ §28 (fields), §29 (lifecycle).
//
// The criteria are: every required field is checked, there is a preview, and
// submission goes to moderation. The preview is a component; what belongs
// here is the rule about what "filled in" means, and the lifecycle that
// follows from it.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createDraftPoint,
  decidePoint,
  missingRequiredFields,
  publishOnFirstReport,
  savePointStep,
  submitPointForReview,
} from "./point-service";

const PREFIX = "test_point_";
const ZONE_CODE = "TESTPOINT";

let operatorId: string;
let ownerUserId: string;
let adminUserId: string;
let zoneId: string;

async function wipe() {
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

/** Everything §28 marks "Да", so the point is ready to submit. */
async function fillEverything(pointId: string) {
  await savePointStep(pointId, ownerUserId, "address", {
    country: "SK",
    city: "Bratislava",
    addressLine: "Hlavná 1",
    latitude: 48.15,
    longitude: 17.11,
    gridZoneId: zoneId,
    howToFind: "Behind the supermarket, level -1",
  });
  await savePointStep(pointId, ownerUserId, "equipment", {
    energySource: "SOLAR",
    connectors: [{ type: "CCS2", powerKw: 50, currentAc: false, quantity: 2 }],
  });
  await savePointStep(pointId, ownerUserId, "tariffs", {
    tariffs: [{ fromMinute: 0, toMinute: 1440, priceFiat: 0.39, currency: "EUR", priceTokens: 1 }],
  });
  await savePointStep(pointId, ownerUserId, "payment", {
    paymentMethods: ["TOKEN", "POOLWATT_CARD"],
    visibility: "PUBLIC",
  });
  await savePointStep(pointId, ownerUserId, "connection", {
    ocppVersion: "1.6",
    meterId: `${PREFIX}meter`,
  });
}

beforeAll(async () => {
  await wipe();
  const zone = await prisma.gridZone.create({
    data: { code: ZONE_CODE, country: "SK", name: "Point test zone", currency: "EUR" },
  });
  zoneId = zone.id;

  ownerUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}owner` },
      update: {},
      create: { username: `${PREFIX}owner`, passwordHash: "x" },
    })
  ).id;
  adminUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}admin` },
      update: { role: "ADMIN" },
      create: { username: `${PREFIX}admin`, passwordHash: "x", role: "ADMIN" },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Point test network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.acceptancePoint.deleteMany({ where: { operatorId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("createDraftPoint — the wizard opens on a saved row (§29.2)", () => {
  it("creates the draft before the first field is typed, so nothing is lost", async () => {
    const point = await createDraftPoint(operatorId, ownerUserId, "CHARGING_STATION", "Depot A");

    expect(point.status).toBe("DRAFT");
    expect(point.name).toBe("Depot A");
    expect(await prisma.acceptancePoint.count({ where: { operatorId } })).toBe(1);
  });

  it("refuses to open a wizard on somebody else's network", async () => {
    const stranger = await prisma.user.upsert({
      where: { username: `${PREFIX}stranger` },
      update: {},
      create: { username: `${PREFIX}stranger`, passwordHash: "x" },
    });
    await expect(
      createDraftPoint(operatorId, stranger.id, "CHARGING_STATION", "Not mine"),
    ).rejects.toThrow(/not your/i);
  });
});

describe("missingRequiredFields — what §28 marks as required", () => {
  it("lists everything a fresh draft still owes", async () => {
    const point = await createDraftPoint(operatorId, ownerUserId, "CHARGING_STATION", "Empty");

    const missing = await missingRequiredFields(point.id);

    expect(missing).toEqual(
      expect.arrayContaining([
        "address",
        "coordinates",
        "gridZone",
        "howToFind",
        "energySource",
        "connectors",
        "tariffs",
        "openHours",
        "paymentMethods",
      ]),
    );
  });

  it("is empty once every required block is filled in", async () => {
    const point = await createDraftPoint(operatorId, ownerUserId, "CHARGING_STATION", "Full");
    await fillEverything(point.id);
    await savePointStep(point.id, ownerUserId, "hours", { open24: true });

    expect(await missingRequiredFields(point.id)).toEqual([]);
  });

  it("still asks for connectors when the list was emptied", async () => {
    const point = await createDraftPoint(operatorId, ownerUserId, "CHARGING_STATION", "No plugs");
    await fillEverything(point.id);
    await savePointStep(point.id, ownerUserId, "hours", { open24: true });
    await savePointStep(point.id, ownerUserId, "equipment", {
      energySource: "SOLAR",
      connectors: [],
    });

    expect(await missingRequiredFields(point.id)).toContain("connectors");
  });

  it("asks a powerbank for its storage capacity, and a charging station not", async () => {
    const bank = await createDraftPoint(operatorId, ownerUserId, "POWERBANK", "Bank");
    expect(await missingRequiredFields(bank.id)).toContain("storageKwh");

    const station = await createDraftPoint(operatorId, ownerUserId, "CHARGING_STATION", "Plug");
    expect(await missingRequiredFields(station.id)).not.toContain("storageKwh");
  });
});

describe("submitPointForReview — §29.3 draft → review", () => {
  it("refuses a point that is still missing required fields", async () => {
    const point = await createDraftPoint(operatorId, ownerUserId, "CHARGING_STATION", "Half");

    await expect(submitPointForReview(point.id, ownerUserId)).rejects.toThrow(/required/i);
    const stored = await prisma.acceptancePoint.findUniqueOrThrow({ where: { id: point.id } });
    expect(stored.status).toBe("DRAFT");
  });

  it("sends a complete point to moderation", async () => {
    const point = await createDraftPoint(operatorId, ownerUserId, "CHARGING_STATION", "Ready");
    await fillEverything(point.id);
    await savePointStep(point.id, ownerUserId, "hours", { open24: true });

    const submitted = await submitPointForReview(point.id, ownerUserId);

    expect(submitted.status).toBe("REVIEW");
    expect(submitted.submittedAt).not.toBeNull();
  });
});

describe("decidePoint — the operator's call (§29.4)", () => {
  async function readyPoint() {
    const point = await createDraftPoint(operatorId, ownerUserId, "CHARGING_STATION", "Decide");
    await fillEverything(point.id);
    await savePointStep(point.id, ownerUserId, "hours", { open24: true });
    await submitPointForReview(point.id, ownerUserId);
    return point;
  }

  it("approves into test connection, not straight into the navigator", async () => {
    const point = await readyPoint();

    const decided = await decidePoint(point.id, adminUserId, true, null);

    // §29.4 — publication waits for the equipment's first word.
    expect(decided.status).toBe("TEST");
    expect(decided.publishedAt).toBeNull();
  });

  it("refuses a rejection without a reason", async () => {
    const point = await readyPoint();
    await expect(decidePoint(point.id, adminUserId, false, null)).rejects.toThrow(/reason/i);
  });

  it("sends a rejected point back to the owner with the reason", async () => {
    const point = await readyPoint();

    const decided = await decidePoint(point.id, adminUserId, false, "Photos do not match the address");

    expect(decided.status).toBe("DRAFT");
    expect(decided.reviewNote).toBe("Photos do not match the address");
  });

  it("will not decide a point that was never submitted", async () => {
    const point = await createDraftPoint(operatorId, ownerUserId, "CHARGING_STATION", "Untouched");
    await expect(decidePoint(point.id, adminUserId, true, null)).rejects.toThrow(/review/i);
  });
});

describe("publishOnFirstReport — §29.4 and §29.7", () => {
  async function approvedPoint() {
    const point = await createDraftPoint(operatorId, ownerUserId, "CHARGING_STATION", "Approved");
    await fillEverything(point.id);
    await savePointStep(point.id, ownerUserId, "hours", { open24: true });
    await submitPointForReview(point.id, ownerUserId);
    await decidePoint(point.id, adminUserId, true, null);
    return point;
  }

  it("publishes the point the first time its equipment speaks", async () => {
    const point = await approvedPoint();

    const published = await publishOnFirstReport(point.id);

    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedAt).not.toBeNull();
  });

  it("leaves a point that was never approved where it is", async () => {
    const point = await createDraftPoint(operatorId, ownerUserId, "CHARGING_STATION", "Sneaky");

    const after = await publishOnFirstReport(point.id);

    expect(after.status).toBe("DRAFT");
  });

  it("does not move the publication date on later reports", async () => {
    const point = await approvedPoint();
    const first = await publishOnFirstReport(point.id);
    const again = await publishOnFirstReport(point.id);

    expect(again.publishedAt?.toISOString()).toBe(first.publishedAt?.toISOString());
  });
});

describe("editing a published point — §29.5", () => {
  async function publishedPoint() {
    const point = await createDraftPoint(operatorId, ownerUserId, "CHARGING_STATION", "Live");
    await fillEverything(point.id);
    await savePointStep(point.id, ownerUserId, "hours", { open24: true });
    await submitPointForReview(point.id, ownerUserId);
    await decidePoint(point.id, adminUserId, true, null);
    await publishOnFirstReport(point.id);
    return point;
  }

  it("lets the owner change tariffs without going back to moderation", async () => {
    const point = await publishedPoint();

    await savePointStep(point.id, ownerUserId, "tariffs", {
      tariffs: [{ fromMinute: 0, toMinute: 1440, priceFiat: 0.44, currency: "EUR", priceTokens: 1 }],
    });

    const stored = await prisma.acceptancePoint.findUniqueOrThrow({ where: { id: point.id } });
    expect(stored.status).toBe("PUBLISHED");
  });

  it("lets the owner change opening hours without going back to moderation", async () => {
    const point = await publishedPoint();
    await savePointStep(point.id, ownerUserId, "hours", { open24: false, holidayNote: "Closed 25 Dec" });
    const stored = await prisma.acceptancePoint.findUniqueOrThrow({ where: { id: point.id } });
    expect(stored.status).toBe("PUBLISHED");
  });

  it("sends a changed address back to moderation", async () => {
    const point = await publishedPoint();

    await savePointStep(point.id, ownerUserId, "address", {
      country: "SK",
      city: "Košice",
      addressLine: "Hlavná 2",
      latitude: 48.72,
      longitude: 21.25,
      gridZoneId: zoneId,
      howToFind: "Behind the supermarket, level -1",
    });

    const stored = await prisma.acceptancePoint.findUniqueOrThrow({ where: { id: point.id } });
    expect(stored.status).toBe("REVIEW");
  });

  it("sends changed equipment back to moderation", async () => {
    const point = await publishedPoint();

    await savePointStep(point.id, ownerUserId, "equipment", {
      energySource: "WIND",
      connectors: [{ type: "TYPE2", powerKw: 22, currentAc: true, quantity: 4 }],
    });

    const stored = await prisma.acceptancePoint.findUniqueOrThrow({ where: { id: point.id } });
    expect(stored.status).toBe("REVIEW");
  });

  it("refuses a step from somebody who does not own the network", async () => {
    const point = await publishedPoint();
    const stranger = await prisma.user.findFirstOrThrow({
      where: { username: `${PREFIX}stranger` },
    });

    await expect(
      savePointStep(point.id, stranger.id, "hours", { open24: true }),
    ).rejects.toThrow(/not your/i);
  });
});
