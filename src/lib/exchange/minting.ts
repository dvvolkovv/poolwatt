// Telemetry validation and token minting — ТЗ §5, §16.1–§16.2, US-04.
//
// Minting is the only way kWh enter the system, so every guard that keeps the
// registry honest lives here: an asset must have served its probation, a
// reading must be physically plausible, and one reading mints exactly once
// (enforced in the DB by MeterReading.id ↔ EnergyToken.readingId being 1:1).

import { AssetStatus, ReadingValidationStatus } from "@prisma/client";
import { floorKwh, roundKwh } from "./precision";

/** §4: "7 дней телеметрии без расхождений" before an asset goes ACTIVE. */
export const TELEMETRY_PROBATION_DAYS = 7;

/**
 * How far a reading may exceed the asset's nameplate output before it is held
 * for review. Inverters do overshoot nameplate briefly (cold, bright days), so
 * a small headroom avoids flagging honest readings.
 */
export const NAMEPLATE_TOLERANCE_PCT = 10;

/** How far a reading may sit below the weather forecast before review. */
export const FORECAST_TOLERANCE_PCT = 60;

export interface ReadingInput {
  energyKwh: number;
  /** Length of the settlement interval, from GridZone.intervalMinutes. */
  intervalMinutes: number;
  /** Asset nameplate, kW. */
  capacityKw: number;
  /** Weather-model expectation for this interval, when available. */
  expectedKwh?: number | null;
}

export interface ReadingOutcome {
  status: ReadingValidationStatus;
  note: string | null;
  /** kWh to mint — only non-zero when status is VALID. */
  mintKwh: number;
}

/** Maximum energy an asset can physically deliver in one interval. */
export function theoreticalMaxKwh(capacityKw: number, intervalMinutes: number): number {
  if (!(intervalMinutes > 0)) {
    throw new RangeError(`intervalMinutes must be positive, got ${intervalMinutes}`);
  }
  return roundKwh((capacityKw * intervalMinutes) / 60);
}

/**
 * Classify one reading (§14 received → valid / suspicious / rejected).
 *
 * REJECTED is for data that cannot be true at all (negative, non-finite) and
 * never mints. SUSPICIOUS is for data that could be true but smells wrong; it
 * goes to the manual queue and also resets the asset's clean-telemetry clock.
 */
export function validateReading(input: ReadingInput): ReadingOutcome {
  const { energyKwh, intervalMinutes, capacityKw, expectedKwh } = input;

  if (!Number.isFinite(energyKwh)) {
    return { status: ReadingValidationStatus.REJECTED, note: "Non-numeric reading", mintKwh: 0 };
  }
  if (energyKwh < 0) {
    return {
      status: ReadingValidationStatus.REJECTED,
      note: "Negative energy — a generation meter cannot run backwards",
      mintKwh: 0,
    };
  }

  const max = theoreticalMaxKwh(capacityKw, intervalMinutes);
  const ceiling = roundKwh(max * (1 + NAMEPLATE_TOLERANCE_PCT / 100));
  if (energyKwh > ceiling) {
    return {
      status: ReadingValidationStatus.SUSPICIOUS,
      note: `Reading ${roundKwh(energyKwh)} kWh exceeds the ${max} kWh nameplate ceiling for a ${intervalMinutes} min interval`,
      mintKwh: 0,
    };
  }

  if (expectedKwh != null && expectedKwh > 0) {
    const deviationPct = ((expectedKwh - energyKwh) / expectedKwh) * 100;
    if (deviationPct > FORECAST_TOLERANCE_PCT) {
      return {
        status: ReadingValidationStatus.SUSPICIOUS,
        note: `Reading is ${Math.round(deviationPct)}% below the ${roundKwh(expectedKwh)} kWh weather forecast`,
        mintKwh: 0,
      };
    }
  }

  // Zero is valid — night, maintenance, curtailment — it simply mints nothing.
  return {
    status: ReadingValidationStatus.VALID,
    note: null,
    mintKwh: roundKwh(energyKwh),
  };
}

export interface MintEligibility {
  status: AssetStatus;
  telemetryCleanSince: Date | null;
}

/**
 * §4: "Не активировать выпуск токенов, пока не пройдены проверка документов и
 * тестовый период телеметрии". ACTIVE assets mint; TEST assets accept and
 * validate telemetry but mint nothing.
 */
export function canMint(asset: MintEligibility): boolean {
  return asset.status === AssetStatus.ACTIVE;
}

/**
 * Whether a TEST asset has now served its probation and may be promoted.
 * The operator still has to approve the promotion (§14).
 */
export function probationComplete(
  asset: MintEligibility,
  now: Date,
  probationDays = TELEMETRY_PROBATION_DAYS,
): boolean {
  if (asset.status !== AssetStatus.TEST) return false;
  if (!asset.telemetryCleanSince) return false;
  const elapsedMs = now.getTime() - asset.telemetryCleanSince.getTime();
  return elapsedMs >= probationDays * 24 * 60 * 60 * 1000;
}

export interface MintShares {
  toMarketPct: number;
  toStoragePct: number;
  toSelfPct: number;
}

export interface MintSplit {
  toMarketKwh: number;
  toStorageKwh: number;
  toSelfKwh: number;
}

/**
 * §30 "Правила продажи" — split a minted interval between the exchange, the
 * owner's storage and self-consumption.
 *
 * Shares are floored so the split can never exceed what was minted; whatever
 * the flooring leaves over goes to the market, which is the default
 * destination for unallocated energy (§16.4).
 */
export function splitMint(mintKwh: number, shares: MintShares): MintSplit {
  const total = roundKwh(mintKwh);
  if (total < 0) throw new RangeError(`Cannot split a negative mint: ${mintKwh}`);

  const sum = shares.toMarketPct + shares.toStoragePct + shares.toSelfPct;
  if (sum <= 0) {
    throw new RangeError("Sale-rule shares must add up to a positive percentage");
  }
  // Tolerate shares that do not sum to exactly 100 by treating them as weights.
  const toStorageKwh = floorKwh((total * shares.toStoragePct) / sum);
  const toSelfKwh = floorKwh((total * shares.toSelfPct) / sum);
  const toMarketKwh = roundKwh(total - toStorageKwh - toSelfKwh);

  return { toMarketKwh, toStorageKwh, toSelfKwh };
}
