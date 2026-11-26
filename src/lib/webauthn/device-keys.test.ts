// §25 SCA. Здесь проверяется то, что написали мы: жизнь одноразового вызова,
// кому принадлежит ключ и правило счётчика. Саму подпись проверяет библиотека
// (у неё свои тесты), а весь путь целиком — e2e на Pixel 7 через виртуальный
// аутентификатор Chrome, который ставит настоящие подписи.
//
// Порядок проверок в коде не случаен: вызов съедается первым, поэтому ни один
// случай ниже до разбора подписи не доходит — и это ровно то поведение, какое
// нужно: отыгранный вызов не даёт даже попытки.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  CHALLENGE_TTL_MS,
  DeviceKeyError,
  assertionChallenge,
  forgetDevice,
  hasDeviceKey,
  listDevices,
  purgeWebAuthnChallenges,
  registerDevice,
  registrationChallenge,
  verifyAssertion,
} from "./device-keys";
import { relyingParty } from "./relying-party";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/types";

const PREFIX = "test_devicekey_";
const RP = { rpId: "poolwatt.test", rpName: "Poolwatt", origins: ["https://poolwatt.test"] };

let meId: string;
let otherId: string;

function clientData(challenge: string, type = "webauthn.get"): string {
  return Buffer.from(
    JSON.stringify({ type, challenge, origin: "https://poolwatt.test" }),
  ).toString("base64url");
}

function assertionWith(challenge: string, credentialId: string): AuthenticationResponseJSON {
  return {
    id: credentialId,
    rawId: credentialId,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData(challenge),
      authenticatorData: Buffer.alloc(37).toString("base64url"),
      signature: Buffer.alloc(64).toString("base64url"),
    },
  };
}

function registrationWith(challenge: string): RegistrationResponseJSON {
  return {
    id: "reg-credential",
    rawId: "reg-credential",
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData(challenge, "webauthn.create"),
      attestationObject: Buffer.alloc(16).toString("base64url"),
    },
  };
}

async function wipe() {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  meId = (await prisma.user.create({ data: { username: `${PREFIX}me`, passwordHash: "x" } })).id;
  otherId = (
    await prisma.user.create({ data: { username: `${PREFIX}other`, passwordHash: "x" } })
  ).id;
});

beforeEach(async () => {
  await prisma.webAuthnChallenge.deleteMany({ where: { userId: { in: [meId, otherId] } } });
  await prisma.deviceKey.deleteMany({ where: { userId: { in: [meId, otherId] } } });
});

afterAll(async () => {
  await wipe();
});

/** Привязанный ключ, минуя проверку подписи: она не предмет этого файла. */
async function linkKey(userId: string, credentialId: string, counter = 0) {
  return prisma.deviceKey.create({
    data: {
      userId,
      credentialId,
      publicKey: Buffer.alloc(32, 1),
      counter: BigInt(counter),
      transports: ["internal"],
      name: "Test phone",
    },
  });
}

describe("relyingParty", () => {
  it("takes the domain from the one place the callback address comes from", () => {
    const rp = relyingParty({ NEXTAUTH_URL: "https://poolwatt.com" });
    expect(rp.rpId).toBe("poolwatt.com");
    expect(rp.origins).toContain("https://poolwatt.com");
    // Оболочка на iOS открывает страницу по своей схеме.
    expect(rp.origins).toContain("capacitor://localhost");
  });

  it("does not fall over on a broken address", () => {
    expect(relyingParty({ NEXTAUTH_URL: "not a url" }).rpId).toBe("localhost");
  });
});

describe("registrationChallenge", () => {
  it("writes the challenge down, so a replay has nothing to replay", async () => {
    const options = await registrationChallenge(meId, `${PREFIX}me`, RP);
    const row = await prisma.webAuthnChallenge.findUniqueOrThrow({
      where: { challenge: options.challenge },
    });
    expect(row).toMatchObject({ userId: meId, purpose: "register", usedAt: null });
    expect(options.rp.id).toBe("poolwatt.test");
    // §25 — именно встроенный аутентификатор с проверкой человека.
    expect(options.authenticatorSelection?.userVerification).toBe("required");
    expect(options.authenticatorSelection?.authenticatorAttachment).toBe("platform");
  });

  it("does not offer a device that is already linked", async () => {
    await linkKey(meId, Buffer.from("already-here").toString("base64url"));
    const options = await registrationChallenge(meId, `${PREFIX}me`, RP);
    expect(options.excludeCredentials).toHaveLength(1);
  });
});

describe("registerDevice — the challenge must be open", () => {
  it("refuses a challenge nobody issued", async () => {
    await expect(
      registerDevice({ userId: meId, response: registrationWith("made-up"), rp: RP }),
    ).rejects.toThrow(DeviceKeyError);
  });

  it("refuses a challenge issued to somebody else", async () => {
    const options = await registrationChallenge(otherId, `${PREFIX}other`, RP);
    await expect(
      registerDevice({ userId: meId, response: registrationWith(options.challenge), rp: RP }),
    ).rejects.toThrow(/not open/);
  });

  it("refuses a challenge issued for another purpose", async () => {
    await linkKey(meId, "k1");
    const options = await assertionChallenge(meId, "transfer", RP);
    await expect(
      registerDevice({ userId: meId, response: registrationWith(options.challenge), rp: RP }),
    ).rejects.toThrow(/not open/);
  });

  it("refuses a challenge older than two minutes", async () => {
    const options = await registrationChallenge(meId, `${PREFIX}me`, RP);
    await prisma.webAuthnChallenge.update({
      where: { challenge: options.challenge },
      data: { createdAt: new Date(Date.now() - CHALLENGE_TTL_MS - 1_000) },
    });
    await expect(
      registerDevice({ userId: meId, response: registrationWith(options.challenge), rp: RP }),
    ).rejects.toThrow(/not open/);
  });

  it("eats the challenge, so the same answer never works twice", async () => {
    const options = await registrationChallenge(meId, `${PREFIX}me`, RP);
    // Первая попытка падает на разборе подписи — но вызов уже съеден.
    await expect(
      registerDevice({ userId: meId, response: registrationWith(options.challenge), rp: RP }),
    ).rejects.toThrow(DeviceKeyError);
    await expect(
      registerDevice({ userId: meId, response: registrationWith(options.challenge), rp: RP }),
    ).rejects.toThrow(/not open/);
  });
});

describe("assertionChallenge", () => {
  it("has nothing to ask of an account with no device", async () => {
    await expect(assertionChallenge(meId, "transfer", RP)).rejects.toThrow(/No device/);
  });

  it("asks only for the keys this account linked", async () => {
    await linkKey(meId, Buffer.from("mine").toString("base64url"));
    await linkKey(otherId, Buffer.from("theirs").toString("base64url"));
    const options = await assertionChallenge(meId, "transfer", RP);
    expect(options.allowCredentials).toHaveLength(1);
    expect(options.userVerification).toBe("required");
  });
});

describe("verifyAssertion — whose key it is", () => {
  it("does not take somebody else's device for your signature", async () => {
    await linkKey(meId, "my-key");
    await linkKey(otherId, "their-key");
    const options = await assertionChallenge(meId, "transfer", RP);

    await expect(
      verifyAssertion({
        userId: meId,
        purpose: "transfer",
        response: assertionWith(options.challenge, "their-key"),
        rp: RP,
      }),
    ).rejects.toThrow(/not linked/);
  });

  it("does not take a key nobody linked", async () => {
    await linkKey(meId, "my-key");
    const options = await assertionChallenge(meId, "transfer", RP);
    await expect(
      verifyAssertion({
        userId: meId,
        purpose: "transfer",
        response: assertionWith(options.challenge, "no-such-key"),
        rp: RP,
      }),
    ).rejects.toThrow(/not linked/);
  });

  it("refuses an answer to a challenge of another purpose", async () => {
    await linkKey(meId, "my-key");
    const options = await registrationChallenge(meId, `${PREFIX}me`, RP);
    await expect(
      verifyAssertion({
        userId: meId,
        purpose: "transfer",
        response: assertionWith(options.challenge, "my-key"),
        rp: RP,
      }),
    ).rejects.toThrow(/not open/);
  });
});

describe("listDevices, forgetDevice, hasDeviceKey", () => {
  it("lists what this account linked, newest last", async () => {
    await linkKey(meId, "a");
    await linkKey(meId, "b");
    const devices = await listDevices(meId);
    expect(devices).toHaveLength(2);
    expect(devices[0].name).toBe("Test phone");
    expect(devices[0].lastUsedAt).toBeNull();
  });

  it("forgets only your own device", async () => {
    const mine = await linkKey(meId, "a");
    const theirs = await linkKey(otherId, "b");
    expect(await forgetDevice(meId, theirs.id)).toBe(false);
    expect(await forgetDevice(meId, mine.id)).toBe(true);
    expect(await hasDeviceKey(meId)).toBe(false);
  });

  it("says whether an account has a device at all", async () => {
    expect(await hasDeviceKey(meId)).toBe(false);
    await linkKey(meId, "a");
    expect(await hasDeviceKey(meId)).toBe(true);
  });
});

describe("purgeWebAuthnChallenges", () => {
  it("drops what expired and leaves what is still open", async () => {
    const fresh = await registrationChallenge(meId, `${PREFIX}me`, RP);
    const stale = await registrationChallenge(meId, `${PREFIX}me`, RP);
    await prisma.webAuthnChallenge.update({
      where: { challenge: stale.challenge },
      data: { createdAt: new Date(Date.now() - CHALLENGE_TTL_MS - 1_000) },
    });

    const removed = await purgeWebAuthnChallenges();

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.webAuthnChallenge.findUnique({ where: { challenge: stale.challenge } }),
    ).toBeNull();
    expect(
      await prisma.webAuthnChallenge.findUnique({ where: { challenge: fresh.challenge } }),
    ).not.toBeNull();
  });
});
