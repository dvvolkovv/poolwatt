// Asset and telemetry actions of the producer cabinet — ТЗ §4, §12 US-03, §30.

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

let mockUser: { id: string; username: string; role: "USER" | "ADMIN" } | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUser ? { user: mockUser } : null)),
}));

import { addAsset, issueKey, revokeKey, saveSaleRules } from "./actions";

const PREFIX = "test_assetact_";
const ZONE = "TESTASSETACT";
let ownerId: string;
let strangerId: string;
let zoneId: string;
let companyId: string;

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { actor: { startsWith: PREFIX } } });
  await prisma.meterReading.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  ownerId = (await prisma.user.create({ data: { username: PREFIX + "owner", passwordHash: "x" } })).id;
  strangerId = (await prisma.user.create({ data: { username: PREFIX + "stranger", passwordHash: "x" } })).id;
  zoneId = (await prisma.gridZone.create({
    data: {
      code: ZONE, country: "SK", name: ZONE, currency: "EUR", intervalMinutes: 15,
      corridorPct: new Prisma.Decimal(30), spotPrice: new Prisma.Decimal(0.2),
    },
  })).id;
});

afterAll(cleanup);

beforeEach(async () => {
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  companyId = (await prisma.company.create({
    data: {
      legalName: PREFIX + "Co", country: "SK", regNumber: PREFIX + "reg",
      type: "PRODUCER", ownerUserId: ownerId, kybStatus: "APPROVED",
    },
  })).id;
  mockUser = { id: ownerId, username: PREFIX + "owner", role: "USER" };
});

const newAsset = (over: Record<string, unknown> = {}) =>
  addAsset(companyId, {
    kind: "SOLAR",
    name: "Roof A",
    capacityKw: 12.5,
    gridZoneId: zoneId,
    address: "Bratislava",
    ...over,
  });

describe("addAsset — US-03", () => {
  it("creates the asset in TEST once the company passed KYB", async () => {
    const result = await newAsset();
    expect(result.ok).toBe(true);
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: result.assetId! } });
    expect(asset.status).toBe("TEST");
    expect(Number(asset.capacityKw)).toBe(12.5);
  });

  it("keeps the asset in DRAFT while the company is unapproved", async () => {
    await prisma.company.update({ where: { id: companyId }, data: { kybStatus: "PENDING" } });
    const result = await newAsset();
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: result.assetId! } });
    expect(asset.status).toBe("DRAFT");
  });

  it("insists on a storage capacity for a powerbank", async () => {
    const result = await newAsset({ kind: "STORAGE", storageKwh: null });
    expect(result.ok).toBe(false);
    expect(result.formError).toMatch(/storage/i);
  });

  it("refuses to add an asset to someone else's company", async () => {
    mockUser = { id: strangerId, username: PREFIX + "stranger", role: "USER" };
    expect((await newAsset()).ok).toBe(false);
  });

  it("reports a bad capacity as a field error", async () => {
    const result = await newAsset({ capacityKw: 0 });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.capacityKw).toBeTruthy();
  });
});

describe("issueKey / revokeKey — US-03", () => {
  it("returns the plaintext once and stores only its hash", async () => {
    const asset = await newAsset();
    const issued = await issueKey(asset.assetId!, "Inverter cloud");

    expect(issued.ok).toBe(true);
    expect(issued.plaintext).toMatch(/^pwt_/);
    const stored = await prisma.assetApiKey.findFirstOrThrow({
      where: { assetId: asset.assetId! },
    });
    expect(stored.tokenHash).not.toContain(issued.plaintext!);
    expect(issued.plaintext!.startsWith(stored.prefix)).toBe(true);
  });

  it("revokes a key so telemetry with it stops working", async () => {
    const asset = await newAsset();
    const issued = await issueKey(asset.assetId!, null);
    const keyId = (
      await prisma.assetApiKey.findFirstOrThrow({ where: { assetId: asset.assetId! } })
    ).id;

    expect(issued.ok).toBe(true);
    const result = await revokeKey(asset.assetId!, keyId);
    expect(result.ok).toBe(true);
    const after = await prisma.assetApiKey.findUniqueOrThrow({ where: { id: keyId } });
    expect(after.revokedAt).toBeInstanceOf(Date);
  });

  it("refuses to issue a key on someone else's asset", async () => {
    const asset = await newAsset();
    mockUser = { id: strangerId, username: PREFIX + "stranger", role: "USER" };
    expect((await issueKey(asset.assetId!, null)).ok).toBe(false);
  });
});

describe("saveSaleRules — §30", () => {
  it("saves the split when it adds up to 100", async () => {
    const asset = await newAsset();
    const result = await saveSaleRules(asset.assetId!, {
      minSalePrice: 0.12,
      shareToMarketPct: 70,
      shareToStoragePct: 20,
      shareToSelfPct: 10,
    });
    expect(result.ok).toBe(true);
    const stored = await prisma.asset.findUniqueOrThrow({ where: { id: asset.assetId! } });
    expect(stored.shareToMarketPct).toBe(70);
    expect(Number(stored.minSalePrice)).toBe(0.12);
  });

  it("refuses a split that does not add up to 100", async () => {
    const asset = await newAsset();
    const result = await saveSaleRules(asset.assetId!, {
      shareToMarketPct: 70,
      shareToStoragePct: 20,
      shareToSelfPct: 20,
    });
    expect(result.ok).toBe(false);
    expect(result.formError).toMatch(/100/);
  });

  it("refuses to touch someone else's asset", async () => {
    const asset = await newAsset();
    mockUser = { id: strangerId, username: PREFIX + "stranger", role: "USER" };
    expect((await saveSaleRules(asset.assetId!, { shareToMarketPct: 100, shareToStoragePct: 0, shareToSelfPct: 0 })).ok).toBe(false);
  });
});
