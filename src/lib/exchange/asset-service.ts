// Generation and storage assets — ТЗ §4, §12 (US-03), §14, §15
// (POST /v1/assets, POST /v1/assets/{id}/keys).

import { AssetKind, AssetStatus, KybStatus, Prisma, AssetAlertKind } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { encryptionKeyConfigured, open, seal } from "@/lib/crypto-box";
import { prisma } from "@/lib/prisma";
import { type Db, writeAudit } from "./audit";
import { raiseAlert } from "./asset-alerts";
import { num } from "./decimal";
import { probationComplete } from "./minting";
import { roundKwh } from "./precision";

const KEY_PREFIX = "pwt_";
const SIGNING_PREFIX = "pws_";

export class AssetError extends Error {}

/**
 * Telemetry credential. Same shape as the charger-operator key: a 256-bit
 * random token shown once, stored only as SHA-256.
 */
export function generateAssetKey(): { plaintext: string; hash: string; prefix: string } {
  const raw = randomBytes(32).toString("base64url");
  const plaintext = `${KEY_PREFIX}${raw}`;
  return {
    plaintext,
    hash: hashAssetKey(plaintext),
    prefix: plaintext.slice(0, KEY_PREFIX.length + 6),
  };
}

export function hashAssetKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function looksLikeAssetKey(s: string): boolean {
  return s.startsWith(KEY_PREFIX) && s.length >= KEY_PREFIX.length + 30;
}

/**
 * §15 signing secret. Unlike the key itself it has to be recoverable — a
 * signature is verified by recomputing it — so it is sealed, not hashed.
 */
export function generateSigningSecret(): string {
  return `${SIGNING_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** The secret a key signs with, or null when the key predates signing. */
export function assetKeySigningSecret(key: {
  signingSecretEnc: string | null;
  signingSecretIv: string | null;
}): string | null {
  if (!key.signingSecretEnc || !key.signingSecretIv) return null;
  return open(key.signingSecretEnc, key.signingSecretIv);
}

export interface CreateAssetInput {
  companyId: string;
  kind: AssetKind;
  name: string;
  capacityKw: number;
  storageKwh?: number | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gridZoneId: string;
  meterId?: string | null;
  goCertificateRef?: string | null;
  actorUserId: string;
}

/** POST /v1/assets. */
export async function createAsset(input: CreateAssetInput, db: Db = prisma) {
  if (!(input.capacityKw > 0)) throw new AssetError("Capacity must be positive");
  if (
    (input.kind === AssetKind.STORAGE || input.kind === AssetKind.MIXED) &&
    !(input.storageKwh && input.storageKwh > 0)
  ) {
    throw new AssetError("A storage asset needs a storage capacity in kWh");
  }

  const company = await db.company.findUniqueOrThrow({ where: { id: input.companyId } });
  // §4 — paperwork first: an unapproved company's assets stay in DRAFT and
  // cannot reach the telemetry probation, let alone mint.
  const status =
    company.kybStatus === KybStatus.APPROVED ? AssetStatus.TEST : AssetStatus.DRAFT;

  const asset = await db.asset.create({
    data: {
      companyId: input.companyId,
      kind: input.kind,
      name: input.name.trim(),
      capacityKw: new Prisma.Decimal(input.capacityKw),
      storageKwh: input.storageKwh != null ? new Prisma.Decimal(input.storageKwh) : null,
      address: input.address?.trim() || null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      gridZoneId: input.gridZoneId,
      meterId: input.meterId?.trim() || null,
      goCertificateRef: input.goCertificateRef?.trim() || null,
      status,
    },
  });

  await writeAudit(db, {
    actor: input.actorUserId,
    entity: "Asset",
    entityId: asset.id,
    action: "asset.created",
    after: { kind: asset.kind, capacityKw: num(asset.capacityKw), status },
  });
  return asset;
}

/**
 * POST /v1/assets/{id}/keys — US-03. Both the key and its §15 signing secret
 * are returned exactly once; neither can be read back afterwards.
 *
 * Without `API_KEY_ENC_KEY` the deployment cannot hold a signing secret, so
 * the key is issued without one and keeps the unsigned path. That is a
 * deliberate fallback, not a silent downgrade: the cabinet says so.
 */
export async function issueAssetKey(
  args: { assetId: string; label?: string | null; actorUserId: string },
  db: Db = prisma,
) {
  const { plaintext, hash, prefix } = generateAssetKey();
  const signingSecret = encryptionKeyConfigured() ? generateSigningSecret() : null;
  const sealed = signingSecret ? seal(signingSecret) : null;

  const key = await db.assetApiKey.create({
    data: {
      assetId: args.assetId,
      label: args.label?.trim() || null,
      tokenHash: hash,
      prefix,
      signingSecretEnc: sealed?.ciphertext ?? null,
      signingSecretIv: sealed?.iv ?? null,
    },
  });
  await writeAudit(db, {
    actor: args.actorUserId,
    entity: "AssetApiKey",
    entityId: key.id,
    action: "asset.key.issued",
    after: { assetId: args.assetId, prefix, signed: signingSecret !== null },
  });
  return { key, plaintext, signingSecret };
}

export async function revokeAssetKey(
  args: { keyId: string; actorUserId: string },
  db: Db = prisma,
) {
  const key = await db.assetApiKey.update({
    where: { id: args.keyId },
    data: { revokedAt: new Date() },
  });
  await writeAudit(db, {
    actor: args.actorUserId,
    entity: "AssetApiKey",
    entityId: key.id,
    action: "asset.key.revoked",
  });
  return key;
}

/** Resolve a telemetry Bearer token to its asset, or null. */
export async function authenticateAssetKey(plaintext: string, db: Db = prisma) {
  if (!looksLikeAssetKey(plaintext)) return null;
  const key = await db.assetApiKey.findUnique({
    where: { tokenHash: hashAssetKey(plaintext) },
    include: { asset: { include: { gridZone: true } } },
  });
  if (!key || key.revokedAt) return null;
  return key;
}

/**
 * §14 test → active. The operator approves, but only once the asset has
 * actually served its clean-telemetry probation.
 */
export async function activateAsset(
  args: { assetId: string; actorUserId: string; now?: Date; force?: boolean },
  db: Db = prisma,
) {
  const asset = await db.asset.findUniqueOrThrow({ where: { id: args.assetId } });
  const now = args.now ?? new Date();

  if (asset.status !== AssetStatus.TEST) {
    throw new AssetError(`Only a TEST asset can be activated, this one is ${asset.status}`);
  }
  if (!args.force && !probationComplete(asset, now)) {
    throw new AssetError(
      "Asset has not completed its clean-telemetry probation (ТЗ §4: 7 days without anomalies)",
    );
  }

  const updated = await db.asset.update({
    where: { id: asset.id },
    data: { status: AssetStatus.ACTIVE, activatedAt: now, suspendedReason: null },
  });
  await writeAudit(db, {
    actor: args.actorUserId,
    entity: "Asset",
    entityId: asset.id,
    action: "asset.activated",
    before: { status: asset.status },
    after: { status: updated.status, forced: Boolean(args.force) },
  });
  return updated;
}

/** §14 active → suspended. */
export async function suspendAsset(
  args: { assetId: string; reason: string; actorUserId: string },
  db: Db = prisma,
) {
  const asset = await db.asset.update({
    where: { id: args.assetId },
    data: {
      status: AssetStatus.SUSPENDED,
      suspendedReason: args.reason,
      // Suspension ends the clean run; a later probation starts from scratch.
      telemetryCleanSince: null,
    },
  });
  await writeAudit(db, {
    actor: args.actorUserId,
    entity: "Asset",
    entityId: asset.id,
    action: "asset.suspended",
    after: { reason: args.reason },
  });
  // §30 / US-29 — a stopped asset is a fault the engineer must hear about.
  await raiseAlert(db, {
    assetId: asset.id,
    kind: AssetAlertKind.SUSPENDED,
    note: args.reason,
  });
  return asset;
}

/** §30 sale rules — min price and the market/storage/self split. */
export async function updateSaleRules(
  args: {
    assetId: string;
    minSalePrice?: number | null;
    shareToMarketPct?: number;
    shareToStoragePct?: number;
    shareToSelfPct?: number;
    /** §30 "резерв на случай отключения" — storage only. */
    reserveSocPct?: number;
    actorUserId: string;
  },
  db: Db = prisma,
) {
  const shares = [args.shareToMarketPct, args.shareToStoragePct, args.shareToSelfPct];
  if (shares.some((s) => s != null)) {
    const sum = shares.reduce<number>((acc, s) => acc + (s ?? 0), 0);
    if (sum !== 100) throw new AssetError(`Sale shares must add up to 100, got ${sum}`);
  }

  const before = await db.asset.findUniqueOrThrow({ where: { id: args.assetId } });
  const asset = await db.asset.update({
    where: { id: args.assetId },
    data: {
      ...(args.minSalePrice !== undefined
        ? {
            minSalePrice:
              args.minSalePrice == null ? null : new Prisma.Decimal(args.minSalePrice),
          }
        : {}),
      ...(args.shareToMarketPct != null ? { shareToMarketPct: args.shareToMarketPct } : {}),
      ...(args.shareToStoragePct != null ? { shareToStoragePct: args.shareToStoragePct } : {}),
      ...(args.shareToSelfPct != null ? { shareToSelfPct: args.shareToSelfPct } : {}),
      ...(args.reserveSocPct != null ? { reserveSocPct: args.reserveSocPct } : {}),
    },
  });

  // §30 "изменение пишется в журнал" — the control panel shows this history.
  await writeAudit(db, {
    actor: args.actorUserId,
    entity: "Asset",
    entityId: asset.id,
    action: "asset.rules.updated",
    before: {
      minSalePrice: before.minSalePrice ? num(before.minSalePrice) : null,
      shareToMarketPct: before.shareToMarketPct,
      shareToStoragePct: before.shareToStoragePct,
      shareToSelfPct: before.shareToSelfPct,
      reserveSocPct: before.reserveSocPct,
    },
    after: {
      minSalePrice: asset.minSalePrice ? num(asset.minSalePrice) : null,
      shareToMarketPct: asset.shareToMarketPct,
      shareToStoragePct: asset.shareToStoragePct,
      shareToSelfPct: asset.shareToSelfPct,
      reserveSocPct: asset.reserveSocPct,
    },
  });
  return asset;
}

/** Free capacity of a storage asset, for §16.4 routing. */
export function freeStorageKwh(asset: {
  storageKwh: unknown;
  storedKwh: unknown;
}): number {
  const capacity = num(asset.storageKwh as never);
  const stored = num(asset.storedKwh as never);
  return Math.max(0, roundKwh(capacity - stored));
}
