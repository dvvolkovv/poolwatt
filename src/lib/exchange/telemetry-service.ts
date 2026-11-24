// Telemetry intake and minting — ТЗ §5, §12 (US-03, US-04), §15
// (POST /v1/telemetry/readings), §16.2, §17.
//
// One call accepts up to 1000 intervals. Each reading is validated, stored and
// — if the asset is ACTIVE — minted into exactly one token batch. The
// (assetId, intervalStart) unique index makes a replayed batch a no-op rather
// than a double mint, which is what §16.2 and the §5 double-counting guard
// require.

import { AssetStatus, Prisma, ReadingValidationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { raiseAlert } from "./asset-alerts";
import { type Db, writeAudit } from "./audit";
import { num } from "./decimal";
import { canMint, splitMint, validateReading } from "./minting";
import { roundKwh } from "./precision";
import { notifyTelemetry } from "./realtime-notify";
import { mintToken } from "./token-registry";
import { getOrCreateWallet } from "./wallet-service";
import { intervalEndFor, intervalStartFor } from "./zone-service";

/** §15: "пакет до 1000 интервалов". */
export const MAX_READINGS_PER_BATCH = 1000;

export class TelemetryError extends Error {}

export interface ReadingPayload {
  /** Interval start; snapped to the zone's interval grid. */
  intervalStart: string | Date;
  energyKwh: number;
  /** Weather-model expectation, when the sender has one. */
  expectedKwh?: number | null;
}

export interface IngestOutcome {
  accepted: number;
  duplicates: number;
  minted: number;
  mintedKwh: number;
  suspicious: number;
  rejected: number;
  results: {
    intervalStart: string;
    status: ReadingValidationStatus | "DUPLICATE";
    mintedKwh: number;
    note: string | null;
  }[];
}

export async function ingestReadings(
  args: { assetId: string; readings: ReadingPayload[]; source?: string },
): Promise<IngestOutcome> {
  if (args.readings.length === 0) throw new TelemetryError("No readings in the batch");
  if (args.readings.length > MAX_READINGS_PER_BATCH) {
    throw new TelemetryError(
      `Batch of ${args.readings.length} exceeds the ${MAX_READINGS_PER_BATCH} interval limit`,
    );
  }

  const source = args.source ?? "rest";
  const outcome: IngestOutcome = {
    accepted: 0,
    duplicates: 0,
    minted: 0,
    mintedKwh: 0,
    suspicious: 0,
    rejected: 0,
    results: [],
  };

  const asset = await prisma.asset.findUniqueOrThrow({
    where: { id: args.assetId },
    include: { gridZone: true, company: true },
  });
  if (asset.status === AssetStatus.SUSPENDED) {
    throw new TelemetryError("Asset is suspended; telemetry is not accepted");
  }

  const intervalMinutes = asset.gridZone.intervalMinutes;
  const capacityKw = num(asset.capacityKw);
  // Tokens are credited to the company owner's wallet in the asset's zone.
  const ownerWallet = asset.company.ownerUserId
    ? await getOrCreateWallet(asset.company.ownerUserId, asset.gridZoneId)
    : null;

  let anomalySeen = false;

  for (const reading of args.readings) {
    const at = new Date(reading.intervalStart);
    if (Number.isNaN(at.getTime())) {
      outcome.rejected += 1;
      outcome.results.push({
        intervalStart: String(reading.intervalStart),
        status: ReadingValidationStatus.REJECTED,
        mintedKwh: 0,
        note: "Unparseable interval start",
      });
      continue;
    }
    const intervalStart = intervalStartFor(at, intervalMinutes);
    const intervalEnd = intervalEndFor(at, intervalMinutes);

    const existing = await prisma.meterReading.findUnique({
      where: { assetId_intervalStart: { assetId: asset.id, intervalStart } },
    });
    if (existing) {
      // §16.2 — the interval already minted (or already failed); replaying it
      // must not create a second token.
      outcome.duplicates += 1;
      outcome.results.push({
        intervalStart: intervalStart.toISOString(),
        status: "DUPLICATE",
        mintedKwh: 0,
        note: `Interval already recorded as ${existing.validationStatus}`,
      });
      continue;
    }

    const verdict = validateReading({
      energyKwh: reading.energyKwh,
      intervalMinutes,
      capacityKw,
      expectedKwh: reading.expectedKwh ?? null,
    });

    const minted = await prisma.$transaction(async (tx) => {
      const row = await tx.meterReading.create({
        data: {
          assetId: asset.id,
          zoneId: asset.gridZoneId,
          intervalStart,
          intervalEnd,
          energyKwh: new Prisma.Decimal(roundKwh(Math.max(0, reading.energyKwh || 0))),
          source,
          validationStatus: verdict.status,
          validationNote: verdict.note,
        },
      });

      if (verdict.status !== ReadingValidationStatus.VALID || verdict.mintKwh <= 0) return 0;
      // §4 — a TEST asset's telemetry is validated and stored but mints nothing.
      if (!canMint(asset) || !ownerWallet) return 0;

      // §30 — the sale rules split the interval before it is offered.
      const split = splitMint(verdict.mintKwh, {
        toMarketPct: asset.shareToMarketPct,
        toStoragePct: asset.shareToStoragePct,
        toSelfPct: asset.shareToSelfPct,
      });

      // The batch minted from the reading carries the whole interval and the
      // 1:1 readingId link; the sale-rule split is recorded on it for the
      // dispatcher, which routes the storage and self shares at interval close.
      await mintToken(tx, {
        assetId: asset.id,
        zoneId: asset.gridZoneId,
        intervalStart,
        amountKwh: verdict.mintKwh,
        readingId: row.id,
        ownerWalletId: ownerWallet.id,
        goCertificateRef: asset.goCertificateRef,
      });
      await tx.meterReading.update({
        where: { id: row.id },
        data: { mintedAt: new Date() },
      });
      await writeAudit(tx, {
        actor: `asset:${asset.id}`,
        entity: "MeterReading",
        entityId: row.id,
        action: "reading.minted",
        after: {
          intervalStart: intervalStart.toISOString(),
          mintKwh: verdict.mintKwh,
          split,
        },
      });
      return verdict.mintKwh;
    });

    outcome.accepted += 1;
    outcome.results.push({
      intervalStart: intervalStart.toISOString(),
      status: verdict.status,
      mintedKwh: minted,
      note: verdict.note,
    });
    if (minted > 0) {
      outcome.minted += 1;
      outcome.mintedKwh = roundKwh(outcome.mintedKwh + minted);
    }
    if (verdict.status === ReadingValidationStatus.SUSPICIOUS) outcome.suspicious += 1;
    if (verdict.status === ReadingValidationStatus.REJECTED) outcome.rejected += 1;
    if (verdict.status !== ReadingValidationStatus.VALID) anomalySeen = true;
  }

  // §30 / US-29 — an anomaly is a fault the engineer has to hear about. One
  // alarm stays open until somebody clears it, however many bad readings
  // arrive meanwhile.
  if (anomalySeen) {
    const worst = outcome.results.find(
      (r) => r.status === ReadingValidationStatus.REJECTED,
    ) ?? outcome.results.find((r) => r.status === ReadingValidationStatus.SUSPICIOUS);
    await raiseAlert(prisma, {
      assetId: asset.id,
      kind: "TELEMETRY_ANOMALY",
      note: worst
        ? `${worst.status} at ${worst.intervalStart}${worst.note ? `: ${worst.note}` : ""}`
        : "a reading failed validation",
    });
  }

  // §4 / §14 — the clean-telemetry clock. A single anomaly restarts the
  // probation; a clean batch starts it if it was not running.
  if (anomalySeen) {
    await prisma.asset.update({
      where: { id: asset.id },
      data: { telemetryCleanSince: null },
    });
  } else if (!asset.telemetryCleanSince && outcome.accepted > 0) {
    await prisma.asset.update({
      where: { id: asset.id },
      data: { telemetryCleanSince: new Date() },
    });
  }

  await prisma.assetApiKey.updateMany({
    where: { assetId: asset.id, revokedAt: null },
    data: { lastUsedAt: new Date() },
  });

  // §15 — the asset's own channel, plus the owner's balance when kWh were
  // minted (US-26 "выработку и доход в реальном времени").
  await notifyTelemetry({
    assetId: asset.id,
    ownerUserId: asset.company.ownerUserId,
    accepted: outcome.accepted,
    minted: outcome.minted,
    mintedKwh: outcome.mintedKwh,
    lastIntervalStart: outcome.results.at(-1)?.intervalStart ?? null,
  });

  return outcome;
}

export interface AssetTokenSummary {
  assetId: string;
  from: string;
  to: string;
  mintedKwh: number;
  availableKwh: number;
  soldKwh: number;
  storedKwh: number;
  routedKwh: number;
  burnedKwh: number;
  batches: {
    id: string;
    intervalStart: string;
    amountKwh: number;
    status: string;
    goCertificateRef: string | null;
  }[];
}

/** GET /v1/assets/{id}/tokens — US-05 dashboard and CSV export. */
export async function readAssetTokens(
  args: { assetId: string; from: Date; to: Date },
  db: Db = prisma,
): Promise<AssetTokenSummary> {
  const batches = await db.energyToken.findMany({
    where: {
      assetId: args.assetId,
      intervalStart: { gte: args.from, lt: args.to },
    },
    orderBy: { intervalStart: "asc" },
  });

  const sumBy = (status: string) =>
    roundKwh(
      batches.filter((b) => b.status === status).reduce((sum, b) => sum + num(b.amountKwh), 0),
    );

  return {
    assetId: args.assetId,
    from: args.from.toISOString(),
    to: args.to.toISOString(),
    mintedKwh: roundKwh(batches.reduce((sum, b) => sum + num(b.amountKwh), 0)),
    availableKwh: sumBy("AVAILABLE"),
    soldKwh: sumBy("SOLD"),
    storedKwh: sumBy("STORED"),
    routedKwh: sumBy("ROUTED"),
    burnedKwh: sumBy("BURNED"),
    batches: batches.map((b) => ({
      id: b.id,
      intervalStart: b.intervalStart.toISOString(),
      amountKwh: num(b.amountKwh),
      status: b.status,
      goCertificateRef: b.goCertificateRef,
    })),
  };
}
