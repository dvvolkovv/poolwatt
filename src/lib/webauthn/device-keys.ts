// §25 «Вход по биометрии, подтверждение платежей по SCA (PSD2)».
//
// Отпечаток на телефоне — это встроенный аутентификатор WebAuthn, и его
// ответ — подпись, которую проверяет сервер. Поэтому здесь нет ни одного
// «клиент сказал, что всё хорошо»: каждая операция опирается на подпись над
// одноразовым вызовом, который этот же сервер и выдал.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/types";

/** Ключ, как его хочет видеть библиотека в `allowCredentials`. */
function descriptor(k: { credentialId: string; transports: string[] }) {
  return {
    id: Buffer.from(k.credentialId, "base64url"),
    type: "public-key" as const,
    transports: (k.transports.length > 0 ? k.transports : undefined) as never,
  };
}
import { prisma } from "@/lib/prisma";
import { relyingParty, type RelyingParty } from "./relying-party";

export class DeviceKeyError extends Error {}

export type ChallengePurpose = "register" | "transfer";

/** Дольше этого вызов не живёт: §25 просит подтверждение, а не разрешение. */
export const CHALLENGE_TTL_MS = 120_000;

/**
 * Съесть вызов. Возвращает false, если его не выдавали, он уже
 * использован, выдан для другой цели, другому человеку или просрочен — то
 * есть во всех случаях, когда подпись принимать нельзя.
 */
async function consumeChallenge(
  userId: string,
  purpose: ChallengePurpose,
  challenge: string,
  now: Date,
): Promise<boolean> {
  const row = await prisma.webAuthnChallenge.findUnique({ where: { challenge } });
  if (!row) return false;
  if (row.userId !== userId || row.purpose !== purpose) return false;
  if (row.usedAt) return false;
  if (now.getTime() - row.createdAt.getTime() > CHALLENGE_TTL_MS) return false;

  // Одна и та же подпись второй раз не пройдёт: вызов больше не свободен.
  const { count } = await prisma.webAuthnChallenge.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: now },
  });
  return count === 1;
}

export async function registrationChallenge(
  userId: string,
  username: string,
  rp: RelyingParty = relyingParty(),
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await prisma.deviceKey.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpID: rp.rpId,
    rpName: rp.rpName,
    userName: username,
    userID: userId,
    // Устройство, которое уже привязано, второй раз не предлагаем.
    excludeCredentials: existing.map(descriptor),
    authenticatorSelection: {
      // §25 просит именно отпечаток или лицо на этом телефоне, а не ключ на
      // шнурке: встроенный аутентификатор с проверкой человека.
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
    timeout: CHALLENGE_TTL_MS,
  });

  await prisma.webAuthnChallenge.create({
    data: { userId, purpose: "register", challenge: options.challenge },
  });
  return options;
}

export async function registerDevice(args: {
  userId: string;
  response: RegistrationResponseJSON;
  name?: string | null;
  rp?: RelyingParty;
  now?: Date;
}): Promise<{ deviceKeyId: string }> {
  const rp = args.rp ?? relyingParty();
  const now = args.now ?? new Date();

  const challenge = args.response.response.clientDataJSON
    ? (JSON.parse(Buffer.from(args.response.response.clientDataJSON, "base64url").toString())
        .challenge as string)
    : "";
  if (!(await consumeChallenge(args.userId, "register", challenge, now))) {
    throw new DeviceKeyError("This challenge is not open");
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: args.response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
    });
  } catch (err) {
    throw new DeviceKeyError(err instanceof Error ? err.message : "Could not verify");
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new DeviceKeyError("The authenticator's answer did not verify");
  }

  const info = verification.registrationInfo;
  const row = await prisma.deviceKey.create({
    data: {
      userId: args.userId,
      credentialId: Buffer.from(info.credentialID).toString("base64url"),
      publicKey: Buffer.from(info.credentialPublicKey),
      counter: BigInt(info.counter),
      transports: (args.response.response.transports ?? []) as string[],
      name: args.name?.trim().slice(0, 60) || null,
    },
  });
  return { deviceKeyId: row.id };
}

export async function assertionChallenge(
  userId: string,
  purpose: ChallengePurpose,
  rp: RelyingParty = relyingParty(),
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const keys = await prisma.deviceKey.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });
  if (keys.length === 0) throw new DeviceKeyError("No device is linked to this account");

  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    allowCredentials: keys.map(descriptor),
    userVerification: "required",
    timeout: CHALLENGE_TTL_MS,
  });

  await prisma.webAuthnChallenge.create({
    data: { userId, purpose, challenge: options.challenge },
  });
  return options;
}

/** Проверить подпись под одним намерением. Отдаёт идентификатор ключа. */
export async function verifyAssertion(args: {
  userId: string;
  purpose: ChallengePurpose;
  response: AuthenticationResponseJSON;
  rp?: RelyingParty;
  now?: Date;
}): Promise<{ deviceKeyId: string }> {
  const rp = args.rp ?? relyingParty();
  const now = args.now ?? new Date();

  const challenge = JSON.parse(
    Buffer.from(args.response.response.clientDataJSON, "base64url").toString(),
  ).challenge as string;

  if (!(await consumeChallenge(args.userId, args.purpose, challenge, now))) {
    throw new DeviceKeyError("This challenge is not open");
  }

  const key = await prisma.deviceKey.findUnique({
    where: { credentialId: args.response.id },
  });
  // Ключ, привязанный к другому человеку, для этой подписи не существует.
  if (!key || key.userId !== args.userId) {
    throw new DeviceKeyError("This device is not linked to your account");
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: args.response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
      authenticator: {
        credentialID: new Uint8Array(Buffer.from(key.credentialId, "base64url")),
        credentialPublicKey: new Uint8Array(key.publicKey),
        counter: Number(key.counter),
        transports: (key.transports.length > 0 ? key.transports : undefined) as never,
      },
    });
  } catch (err) {
    throw new DeviceKeyError(err instanceof Error ? err.message : "Could not verify");
  }
  if (!verification.verified) throw new DeviceKeyError("The signature did not verify");

  // Счётчик идёт только вперёд. Аутентификатор, который его не ведёт, пишет
  // нули — тогда и сравнивать нечего.
  const seen = BigInt(verification.authenticationInfo.newCounter);
  if (seen > BigInt(0) && seen <= key.counter) {
    throw new DeviceKeyError("This answer has been used before");
  }
  await prisma.deviceKey.update({
    where: { id: key.id },
    data: { counter: seen > key.counter ? seen : key.counter, lastUsedAt: now },
  });

  return { deviceKeyId: key.id };
}

export async function listDevices(userId: string) {
  const rows = await prisma.deviceKey.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));
}

export async function forgetDevice(userId: string, deviceKeyId: string): Promise<boolean> {
  const { count } = await prisma.deviceKey.deleteMany({
    where: { id: deviceKeyId, userId },
  });
  return count === 1;
}

export async function hasDeviceKey(userId: string): Promise<boolean> {
  return (
    (await prisma.deviceKey.findFirst({ where: { userId }, select: { id: true } })) !== null
  );
}

/** Просроченные вызовы не нужны никому; чистит воркер. */
export async function purgeWebAuthnChallenges(now = new Date()): Promise<number> {
  const { count } = await prisma.webAuthnChallenge.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - CHALLENGE_TTL_MS) } },
  });
  return count;
}
