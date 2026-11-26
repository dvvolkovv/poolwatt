// §25 — «подтверждение платежей по SCA (PSD2)» для перевода кВт·ч (US-19).
//
// Правило: у кого привязано устройство — без подписи перевод не идёт; у кого
// устройства нет — идёт как раньше. Второе важно не меньше первого:
// требовать биометрию с того, у кого её нет, значит закрыть функцию человеку
// со старым телефоном.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { transferKwh } from "./transfer-service";

const PREFIX = "test_sca_";
const ZONE = "TESTSCA";
const COOP = "test-sca-coop";

let meId: string;
let friendId: string;
let zoneId: string;

async function wipe() {
  await prisma.tokenTransfer.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: COOP } } });
  await prisma.cooperative.deleteMany({ where: { name: COOP } });
  await prisma.company.deleteMany({ where: { regNumber: `${COOP}-reg` } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { regNumber: `${PREFIX}asset` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.deviceKey.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  // §24.4 — функция за переключателем; в этом файле он открыт намеренно.
  vi.stubEnv("KWH_TRANSFERS_ENABLED", "true");

  meId = (await prisma.user.create({ data: { username: `${PREFIX}me`, passwordHash: "x" } })).id;
  friendId = (
    await prisma.user.create({ data: { username: `${PREFIX}friend`, passwordHash: "x" } })
  ).id;

  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "SCA test zone", currency: "EUR" },
  });
  zoneId = zone.id;

  // §24.1 — оба в одном кооперативе и с KYC.
  const company = await prisma.company.create({
    data: {
      legalName: "SCA test coop",
      country: "SK",
      regNumber: `${COOP}-reg`,
      type: "COOPERATIVE",
      kybStatus: "APPROVED",
    },
  });
  const coop = await prisma.cooperative.create({
    data: { companyId: company.id, zoneId, name: COOP },
  });
  for (const userId of [meId, friendId]) {
    await prisma.coopMember.create({
      data: { coopId: coop.id, userId, status: "ACTIVE", shares: 1, kycVerifiedAt: new Date() },
    });
  }

  // У отправителя есть чем переводить: партия кВт·ч в его кошельке.
  const assetCompany = await prisma.company.create({
    data: {
      legalName: "SCA test producer",
      country: "SK",
      regNumber: `${PREFIX}asset`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: assetCompany.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: "SCA array",
      capacityKw: 10,
      status: "ACTIVE",
    },
  });
  const wallet = await prisma.wallet.create({
    data: { ownerUserId: meId, zoneId, currency: "EUR", kwhBalance: 100 },
  });
  await prisma.energyToken.create({
    data: {
      assetId: asset.id,
      zoneId,
      intervalStart: new Date(),
      amountKwh: 100,
      ownerWalletId: wallet.id,
      status: "AVAILABLE",
    },
  });
});

beforeEach(async () => {
  await prisma.deviceKey.deleteMany({ where: { userId: meId } });
  await prisma.webAuthnChallenge.deleteMany({ where: { userId: meId } });
  await prisma.tokenTransfer.deleteMany({ where: { zoneId } });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await wipe();
});

async function linkDevice() {
  await prisma.deviceKey.create({
    data: {
      userId: meId,
      credentialId: "sca-test-key",
      publicKey: Buffer.alloc(32, 1),
      counter: BigInt(0),
      transports: ["internal"],
      name: "SCA test phone",
    },
  });
}

describe("transferKwh — §25 SCA", () => {
  it("goes through without a signature when the account has no device", async () => {
    const result = await transferKwh({
      fromUserId: meId,
      toUsername: `${PREFIX}friend`,
      zoneId,
      amountKwh: 1,
    });
    expect(result.amountKwh).toBe(1);
  });

  it("refuses a transfer with no signature once a device is linked", async () => {
    await linkDevice();
    await expect(
      transferKwh({
        fromUserId: meId,
        toUsername: `${PREFIX}friend`,
        zoneId,
        amountKwh: 1,
      }),
    ).rejects.toThrow(/biometrics linked/);
    // Ничего не сдвинулось.
    expect(await prisma.tokenTransfer.count({ where: { zoneId } })).toBe(0);
  });

  it("refuses a signature over a challenge nobody issued", async () => {
    await linkDevice();
    const madeUp = {
      id: "sca-test-key",
      rawId: "sca-test-key",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: Buffer.from(
          JSON.stringify({ type: "webauthn.get", challenge: "made-up" }),
        ).toString("base64url"),
        authenticatorData: Buffer.alloc(37).toString("base64url"),
        signature: Buffer.alloc(64).toString("base64url"),
      },
    };
    await expect(
      transferKwh({
        fromUserId: meId,
        toUsername: `${PREFIX}friend`,
        zoneId,
        amountKwh: 1,
        sca: madeUp as never,
      }),
    ).rejects.toThrow(/not open/);
    expect(await prisma.tokenTransfer.count({ where: { zoneId } })).toBe(0);
  });
});
