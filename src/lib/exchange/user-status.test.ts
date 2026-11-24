// §20 "Статусы пользователя" — the badge on the main screen and in the
// profile. The tiers are cumulative: a co-op member is also a prosumer and a
// consumer, and what the badge shows is the highest one reached.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readUserStatus } from "./user-status";

const PREFIX = "test_status_";
const ZONE_CODE = "TESTSTATUS";

let zoneId: string;
let coopId: string;
let companyId: string;

async function seedUser(username: string) {
  const user = await prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: "x" },
  });
  return user.id;
}

async function wipe() {
  await prisma.coopMember.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
  await prisma.cooperative.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE_CODE } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

beforeAll(async () => {
  await wipe();
  const zone = await prisma.gridZone.create({
    data: { code: ZONE_CODE, country: "SK", name: "Status test zone", currency: "EUR" },
  });
  zoneId = zone.id;

  const owner = await seedUser(`${PREFIX}owner`);
  const company = await prisma.company.create({
    data: {
      legalName: `${PREFIX}co s.r.o.`,
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId: owner,
    },
  });
  companyId = company.id;

  const coop = await prisma.cooperative.create({
    data: { name: `${PREFIX}coop`, zoneId, companyId: company.id },
  });
  coopId = coop.id;
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("readUserStatus — ТЗ §20", () => {
  it("calls a signed-up account with nothing to its name a guest", async () => {
    const userId = await seedUser(`${PREFIX}nobody`);
    expect(await readUserStatus(userId)).toBe("GUEST");
  });

  it("calls a KYC-verified member a consumer", async () => {
    const userId = await seedUser(`${PREFIX}consumer`);
    await prisma.coopMember.create({
      data: { coopId, userId, status: "ACTIVE", shares: 0, kycVerifiedAt: new Date() },
    });
    expect(await readUserStatus(userId)).toBe("CONSUMER");
  });

  it("does not call a membership still waiting for KYC a consumer", async () => {
    const userId = await seedUser(`${PREFIX}pending`);
    await prisma.coopMember.create({
      data: { coopId, userId, status: "ACTIVE", shares: 0, kycVerifiedAt: null },
    });
    expect(await readUserStatus(userId)).toBe("GUEST");
  });

  it("calls whoever has a generation asset a prosumer", async () => {
    const userId = await seedUser(`${PREFIX}prosumer`);
    const company = await prisma.company.create({
      data: {
        legalName: `${PREFIX}prosumer co`,
        country: "SK",
        regNumber: `${PREFIX}reg2`,
        type: "PRODUCER",
        kybStatus: "APPROVED",
        ownerUserId: userId,
      },
    });
    await prisma.asset.create({
      data: {
        companyId: company.id,
        gridZoneId: zoneId,
        kind: "SOLAR",
        name: "Status test array",
        capacityKw: new Prisma.Decimal(5),
        status: "ACTIVE",
      },
    });
    expect(await readUserStatus(userId)).toBe("PROSUMER");
  });

  it("calls a member who bought shares a co-op member, above everything else", async () => {
    const userId = await seedUser(`${PREFIX}member`);
    await prisma.coopMember.create({
      data: { coopId, userId, status: "ACTIVE", shares: 3, kycVerifiedAt: new Date() },
    });
    await prisma.asset.create({
      data: {
        companyId,
        gridZoneId: zoneId,
        kind: "SOLAR",
        name: "Shared array",
        capacityKw: new Prisma.Decimal(5),
        status: "ACTIVE",
      },
    });
    expect(await readUserStatus(userId)).toBe("COOP_MEMBER");
  });

  it("does not promote a member whose shares were sold off", async () => {
    const userId = await seedUser(`${PREFIX}exmember`);
    await prisma.coopMember.create({
      data: { coopId, userId, status: "ACTIVE", shares: 0, kycVerifiedAt: new Date() },
    });
    expect(await readUserStatus(userId)).toBe("CONSUMER");
  });
});
