// Connector occupancy — ТЗ §27 ("свободен, занят, не работает"), §29.4 and
// §29.7, US-23.
//
// Equipment reports here with the point's own key and an HMAC signature
// (§15), the same shape the exchange assets use. It is deliberately not OCPP:
// a bridge to a charging network is an integration with that network, and a
// household powerbank speaks no OCPP at all. A point that reports for the
// first time is published, which is the second half of §29.4.

import { ConnectorStatus, PointStatus, type EvConnectorType } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { encryptionKeyConfigured, open, seal } from "@/lib/crypto-box";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";
import {
  restCanonicalString,
  verifySignature,
} from "@/lib/exchange/equipment-signature";
import { publishOnFirstReport } from "./point-service";

export class AvailabilityError extends Error {}

const KEY_PREFIX = "pwp_";

export interface IssuedPointKey {
  keyId: string;
  pointId: string;
  token: string;
  /** Shown once; after this only the sealed copy exists. */
  signingSecret: string | null;
}

export async function issuePointKey(
  pointId: string,
  userId: string,
  label: string | null,
): Promise<IssuedPointKey> {
  const point = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    include: { operator: { select: { claimedById: true } } },
  });
  if (!point) throw new AvailabilityError("Point not found");
  if (point.operator.claimedById !== userId) throw new AvailabilityError("Not your network");

  const token = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const signingSecret = encryptionKeyConfigured()
    ? randomBytes(32).toString("base64url")
    : null;
  const sealed = signingSecret ? seal(signingSecret) : null;

  const key = await prisma.pointApiKey.create({
    data: {
      pointId,
      label: label?.trim() || null,
      tokenHash: sha256(token),
      prefix: token.slice(0, 10),
      signingSecretEnc: sealed?.ciphertext ?? null,
      signingSecretIv: sealed?.iv ?? null,
    },
  });
  await writeAudit(prisma, {
    actor: userId,
    entity: "PointApiKey",
    entityId: key.id,
    action: "point.key.issued",
    after: { pointId, prefix: key.prefix, signed: signingSecret !== null },
  });

  return { keyId: key.id, pointId, token, signingSecret };
}

export async function revokePointKey(keyId: string, userId: string): Promise<void> {
  const key = await prisma.pointApiKey.findUnique({
    where: { id: keyId },
    include: { point: { include: { operator: { select: { claimedById: true } } } } },
  });
  if (!key) throw new AvailabilityError("Key not found");
  if (key.point.operator.claimedById !== userId) {
    throw new AvailabilityError("Not your network");
  }
  await prisma.pointApiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
  await writeAudit(prisma, {
    actor: userId,
    entity: "PointApiKey",
    entityId: keyId,
    action: "point.key.revoked",
  });
}

export interface AvailabilityReport {
  token: string;
  /** The parsed body; it is re-serialised to check the signature. */
  body: { connectors: { type: string; status: string }[] };
  signature: string | null;
  timestamp: string | null;
  /** The route as signed, e.g. /v1/points/{id}/availability. */
  path: string;
  now?: Date;
}

export interface AvailabilityResult {
  pointId: string;
  updated: number;
  status: PointStatus;
}

export async function reportAvailability(
  report: AvailabilityReport,
): Promise<AvailabilityResult> {
  const key = await prisma.pointApiKey.findUnique({
    where: { tokenHash: sha256(report.token) },
    include: { point: { select: { id: true, status: true } } },
  });
  if (!key || key.revokedAt) throw new AvailabilityError("Unknown or revoked key");

  // The signed path carries the point id, so a key cannot be replayed against
  // a sibling point of the same network.
  if (!report.path.includes(key.pointId)) {
    throw new AvailabilityError("This key belongs to another point");
  }

  if (key.signingSecretEnc && key.signingSecretIv) {
    const secret = open(key.signingSecretEnc, key.signingSecretIv);
    const verdict = verifySignature({
      secret,
      signature: report.signature,
      timestamp: report.timestamp,
      canonical: restCanonicalString({
        timestamp: report.timestamp ?? "",
        method: "POST",
        path: report.path,
        body: JSON.stringify(report.body),
      }),
      now: report.now,
    });
    if (!verdict.ok) throw new AvailabilityError(`Bad signature: ${verdict.reason}`);
  }

  const now = report.now ?? new Date();
  const connectors = await prisma.pointConnector.findMany({
    where: { pointId: key.pointId },
  });

  let updated = 0;
  for (const reported of report.body.connectors ?? []) {
    const status = asStatus(reported.status);
    if (!status) continue;
    // A connector nobody mentioned keeps what it had: silence is not news.
    const row = connectors.find((c) => c.type === (reported.type as EvConnectorType));
    if (!row) continue;
    await prisma.pointConnector.update({
      where: { id: row.id },
      data: { status, statusAt: now },
    });
    updated += 1;
  }

  await prisma.pointApiKey.update({ where: { id: key.id }, data: { lastUsedAt: now } });
  await prisma.acceptancePoint.update({
    where: { id: key.pointId },
    data: { lastSeenAt: now },
  });

  // §29.4 — "публикация после проверки оператором и первых данных от
  // оборудования". This is those first data.
  const point = await publishOnFirstReport(key.pointId);

  return { pointId: key.pointId, updated, status: point.status };
}

function asStatus(value: string): ConnectorStatus | null {
  return (Object.values(ConnectorStatus) as string[]).includes(value)
    ? (value as ConnectorStatus)
    : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
