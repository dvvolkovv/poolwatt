// What stays shut until KYC, a bank and a legal opinion exist (ТЗ §19, §21, §24).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAsset } from "./asset-service";
import { FeatureClosedError } from "./gates";
import { createCompany, decideApplication, submitApplication } from "./listing-service";
import { recordScreening } from "./screening";
import { openCompanyAccount, openUserAccount } from "./settlement-service";
import { ingestReadings } from "./telemetry-service";
import { cancelTransfer, confirmTransfer, transferKwh } from "./transfer-service";
import { getOrCreateWallet } from "./wallet-service";

const PREFIX = "test_gates_";
const ZONE = "TESTGATES";
const OTHER_ZONE = "TESTGATES2";

let zoneId: string;
let otherZoneId: string;
let producerId: string;
let coopId: string;
const user: Record<string, string> = {};

async function cleanup() {
  const zones = { zone: { code: { in: [ZONE, OTHER_ZONE] } } };
  await prisma.tokenTransfer.deleteMany({ where: zones });
  await prisma.energyToken.deleteMany({ where: zones });
  await prisma.meterReading.deleteMany({ where: zones });
  await prisma.wallet.deleteMany({ where: zones });
  await prisma.asset.deleteMany({ where: { gridZone: { code: { in: [ZONE, OTHER_ZONE] } } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.settlementAccount.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
  await prisma.gridZone.deleteMany({ where: { code: { in: [ZONE, OTHER_ZONE] } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

const makeZone = (code: string) =>
  prisma.gridZone.create({
    data: {
      code, country: "SK", name: code, currency: "EUR", intervalMinutes: 15,
      corridorPct: new Prisma.Decimal(50), spotPrice: new Prisma.Decimal(0.2),
    },
  });

const makeCompany = (name: string) =>
  createCompany({
    legalName: PREFIX + name, country: "SK", regNumber: PREFIX + name,
    type: "COOPERATIVE", ownerUserId: user.owner,
  });

async function makeCoop(name: string, zone: string) {
  const company = await makeCompany(name);
  return (await prisma.cooperative.create({ data: { companyId: company.id, zoneId: zone, name } })).id;
}

const join = (coop: string, userId: string, kyc = true) =>
  prisma.coopMember.create({
    data: {
      coopId: coop, userId,
      status: kyc ? "ACTIVE" : "PENDING",
      kycVerifiedAt: kyc ? new Date() : null,
    },
  });

const balance = async (userId: string) =>
  Number((await getOrCreateWallet(userId, zoneId)).kwhBalance);

const send = (to: string, over: Partial<Parameters<typeof transferKwh>[0]> = {}) =>
  transferKwh({ fromUserId: user.owner, toUsername: PREFIX + to, zoneId, amountKwh: 1, ...over });

beforeAll(async () => {
  await cleanup();
  for (const name of ["owner", "friend", "stranger", "pending", "elsewhere"]) {
    user[name] = (
      await prisma.user.create({ data: { username: PREFIX + name, passwordHash: "x" } })
    ).id;
  }
  zoneId = (await makeZone(ZONE)).id;
  otherZoneId = (await makeZone(OTHER_ZONE)).id;

  // The owner gets kWh the only way there is: metered generation.
  const producer = await makeCompany("producer");
  producerId = producer.id;
  const asset = await createAsset({
    companyId: producerId, kind: "SOLAR", name: "roof", capacityKw: 1000,
    gridZoneId: zoneId, actorUserId: user.owner,
  });
  await prisma.asset.update({ where: { id: asset.id }, data: { status: "ACTIVE" } });
  await ingestReadings({
    assetId: asset.id,
    readings: [{ intervalStart: "2026-11-20T10:00:00.000Z", energyKwh: 100 }],
  });

  coopId = await makeCoop("coop", zoneId);
  await join(coopId, user.owner);
  await join(coopId, user.friend);
  await join(coopId, user.pending, false);
  await join(await makeCoop("other-coop", zoneId), user.stranger);
  const abroad = await makeCoop("abroad", otherZoneId);
  await join(abroad, user.owner);
  await join(abroad, user.elsewhere);
});

afterAll(cleanup);
beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe("settlement accounts", () => {
  const accounts = (where: Prisma.SettlementAccountWhereInput) =>
    prisma.settlementAccount.count({ where });

  it("cannot be opened while no bank issues the IBAN", async () => {
    vi.stubEnv("IBAN_PROVIDER", "");
    await expect(openUserAccount(prisma, user.friend)).rejects.toThrow(FeatureClosedError);
    await expect(openCompanyAccount(prisma, producerId)).rejects.toThrow(FeatureClosedError);
    expect(await accounts({ OR: [{ userId: user.friend }, { companyId: producerId }] })).toBe(0);
  });

  it("cannot be opened in production even when the sandbox is switched on", async () => {
    vi.stubEnv("IBAN_PROVIDER", "sandbox");
    vi.stubEnv("NODE_ENV", "production");
    await expect(openUserAccount(prisma, user.friend)).rejects.toThrow(FeatureClosedError);
    expect(await accounts({ userId: user.friend })).toBe(0);
  });

  it("needs KYC for a person (§21)", async () => {
    vi.stubEnv("IBAN_PROVIDER", "sandbox");
    await expect(openUserAccount(prisma, user.pending)).rejects.toThrow(/KYC/);
    expect(await accounts({ userId: user.pending })).toBe(0);
    expect((await openUserAccount(prisma, user.friend)).iban).toMatch(/^LT\d{18}$/);
  });

  it("does not hold up a listing decision", async () => {
    vi.stubEnv("IBAN_PROVIDER", "");
    const company = await makeCompany("applicant");
    const application = await submitApplication({
      companyId: company.id,
      actorUserId: user.owner,
      documents: [{ name: "l.pdf", url: "https://example.test/l.pdf", bytes: 10, mime: "application/pdf" }],
    });
    // §4 — screening is what gates an approval; a shut IBAN gate is not.
    for (const kind of ["KYB", "SANCTIONS"] as const) {
      await recordScreening({
        companyId: company.id, kind, result: "CLEAR", provider: "manual",
        evidence: "registry extract; sanctions list — no match", checkedById: user.owner,
      });
    }
    const result = await decideApplication({
      applicationId: application.id, reviewerId: user.owner, approve: true,
    });
    expect(result.application.status).toBe("APPROVED");
    expect(result.accountId).toBeNull();
    expect(await accounts({ companyId: company.id })).toBe(0);
  });
});

describe("kWh transfers", () => {
  it("are closed by default and move nothing", async () => {
    vi.stubEnv("KWH_TRANSFERS_ENABLED", "");
    const before = await balance(user.owner);
    await expect(send("friend")).rejects.toThrow(FeatureClosedError);
    expect(await balance(user.owner)).toBe(before);
  });

  it("cannot be confirmed once closed, but can still be cancelled", async () => {
    vi.stubEnv("KWH_TRANSFERS_ENABLED", "true");
    const pending = await send("friend", { requireConfirmation: true });
    vi.stubEnv("KWH_TRANSFERS_ENABLED", "");
    await expect(confirmTransfer(pending.transferId, user.friend)).rejects.toThrow(FeatureClosedError);
    expect((await cancelTransfer(pending.transferId, user.owner)).status).toBe("CANCELLED");
  });

  it("work between KYC-verified members of one cooperative", async () => {
    vi.stubEnv("KWH_TRANSFERS_ENABLED", "true");
    const before = await balance(user.friend);
    expect((await send("friend", { amountKwh: 2 })).status).toBe("CONFIRMED");
    expect(await balance(user.friend)).toBe(before + 2);
  });

  it.each([
    ["a member of another cooperative", "stranger"],
    ["a member without KYC", "pending"],
    ["a fellow member of a cooperative in another zone", "elsewhere"],
  ])("refuse %s", async (_who, to) => {
    vi.stubEnv("KWH_TRANSFERS_ENABLED", "true");
    const before = await balance(user.owner);
    await expect(send(to)).rejects.toThrow(/KYC-verified members of one cooperative/);
    expect(await balance(user.owner)).toBe(before);
  });

  it("check membership again when the recipient confirms", async () => {
    vi.stubEnv("KWH_TRANSFERS_ENABLED", "true");
    const pending = await send("friend", { requireConfirmation: true });
    await prisma.coopMember.updateMany({ where: { coopId, userId: user.friend }, data: { status: "SUSPENDED" } });
    const before = await balance(user.owner);
    await expect(confirmTransfer(pending.transferId, user.friend)).rejects.toThrow(/KYC-verified/);
    expect(await balance(user.owner)).toBe(before);
  });
});
