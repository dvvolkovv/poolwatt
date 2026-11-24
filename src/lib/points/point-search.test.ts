// US-23 — "найти ближайший свободный пункт с моим разъёмом". The criteria are
// a filter by connector and availability, and a result inside two seconds.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { searchPoints } from "./point-search";

const PREFIX = "test_search_";
const SLUG = `${PREFIX}net`;

let operatorId: string;

const BBOX = { south: 48.0, west: 17.0, north: 48.3, east: 17.3 };

async function wipe() {
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

async function seed(args: {
  name: string;
  status?: "DRAFT" | "REVIEW" | "TEST" | "PUBLISHED" | "SUSPENDED";
  lat?: number;
  lng?: number;
  visibility?: "PUBLIC" | "COOP_MEMBERS" | "OWN_CLIENTS";
  connectors: { type: string; powerKw: number; status: string; currentAc?: boolean }[];
}) {
  return prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: args.name,
      status: (args.status ?? "PUBLISHED") as never,
      country: "SK",
      city: "Bratislava",
      addressLine: "Hlavná 1",
      latitude: args.lat ?? 48.15,
      longitude: args.lng ?? 17.11,
      howToFind: "level -1",
      energySource: "SOLAR",
      open24: true,
      paymentMethods: ["TOKEN"],
      visibility: (args.visibility ?? "PUBLIC") as never,
      publishedAt: new Date(),
      connectors: {
        create: args.connectors.map((c) => ({
          type: c.type as never,
          powerKw: c.powerKw,
          currentAc: c.currentAc ?? true,
          quantity: 1,
          status: c.status as never,
        })),
      },
      tariffs: {
        create: [{ fromMinute: 0, toMinute: 1440, priceFiat: 0.35, currency: "EUR" }],
      },
    },
  });
}

beforeAll(async () => {
  await wipe();
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: SLUG, displayName: "Search test network" },
    })
  ).id;

  await seed({
    name: "Free CCS",
    connectors: [{ type: "CCS2", powerKw: 150, status: "FREE", currentAc: false }],
  });
  await seed({
    name: "Busy CCS",
    lat: 48.16,
    connectors: [{ type: "CCS2", powerKw: 150, status: "BUSY", currentAc: false }],
  });
  await seed({
    name: "Free Type2",
    lat: 48.17,
    connectors: [{ type: "TYPE2", powerKw: 22, status: "FREE" }],
  });
  await seed({
    name: "Unknown CCS",
    lat: 48.18,
    connectors: [{ type: "CCS2", powerKw: 50, status: "UNKNOWN", currentAc: false }],
  });
  await seed({
    name: "Still a draft",
    lat: 48.19,
    status: "DRAFT",
    connectors: [{ type: "CCS2", powerKw: 50, status: "FREE", currentAc: false }],
  });
  await seed({
    name: "Suspended",
    lat: 48.2,
    status: "SUSPENDED",
    connectors: [{ type: "CCS2", powerKw: 50, status: "FREE", currentAc: false }],
  });
  await seed({
    name: "Members only",
    lat: 48.21,
    visibility: "COOP_MEMBERS",
    connectors: [{ type: "CCS2", powerKw: 50, status: "FREE", currentAc: false }],
  });
  await seed({
    name: "Far away",
    lat: 52.0,
    lng: 21.0,
    connectors: [{ type: "CCS2", powerKw: 50, status: "FREE", currentAc: false }],
  });
});

afterAll(async () => {
  await wipe();
});

const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();

describe("searchPoints — what a driver may see (§27, §28)", () => {
  it("returns only published, public points inside the box", async () => {
    const rows = await searchPoints({ bbox: BBOX });

    expect(names(rows)).toEqual(["Busy CCS", "Free CCS", "Free Type2", "Unknown CCS"]);
  });

  it("leaves out a point outside the box", async () => {
    const rows = await searchPoints({ bbox: BBOX });
    expect(names(rows)).not.toContain("Far away");
  });
});

describe("searchPoints — the two filters US-23 asks for", () => {
  it("filters by connector type", async () => {
    const rows = await searchPoints({ bbox: BBOX, connector: "CCS2" });
    expect(names(rows)).toEqual(["Busy CCS", "Free CCS", "Unknown CCS"]);
  });

  it("filters by availability, and hides what it cannot vouch for", async () => {
    const rows = await searchPoints({ bbox: BBOX, freeOnly: true });

    // The driver asked for free, not for "maybe": UNKNOWN does not qualify.
    expect(names(rows)).toEqual(["Free CCS", "Free Type2"]);
  });

  it("combines the two", async () => {
    const rows = await searchPoints({ bbox: BBOX, connector: "CCS2", freeOnly: true });
    expect(names(rows)).toEqual(["Free CCS"]);
  });

  it("filters by minimum power", async () => {
    const rows = await searchPoints({ bbox: BBOX, minPowerKw: 100 });
    expect(names(rows)).toEqual(["Busy CCS", "Free CCS"]);
  });
});

describe("searchPoints — shape and speed", () => {
  it("brings the connectors and the current price with it, in one go", async () => {
    const rows = await searchPoints({ bbox: BBOX, connector: "TYPE2" });

    expect(rows).toHaveLength(1);
    expect(rows[0].connectors[0]).toMatchObject({ type: "TYPE2", status: "FREE" });
    expect(rows[0].priceFiat).toBe(0.35);
    expect(rows[0].currency).toBe("EUR");
  });

  it("sorts by distance when the driver shared a position", async () => {
    const rows = await searchPoints({ bbox: BBOX, near: { lat: 48.17, lng: 17.11 } });

    expect(rows[0].name).toBe("Free Type2");
    expect(rows[0].distanceM).toBeLessThan(rows[1].distanceM!);
  });

  it("answers well inside the two seconds US-23 allows", async () => {
    const started = Date.now();
    await searchPoints({ bbox: BBOX, connector: "CCS2", freeOnly: true });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
