// MQTT telemetry intake — ТЗ §4 ("поддержка протоколов Modbus, MQTT,
// IEC 61850"), §12 US-03 ("приём данных по MQTT/REST").
//
// The broker is transport only: it is not the authority on who an asset is.
// Every message carries the asset's telemetry key, exactly like the Bearer
// token on POST /v1/telemetry/readings, and the key must belong to the asset
// named in the topic. So a broker that lets anyone publish still cannot forge
// a reading, and the two intake paths share one authentication rule.

import { authenticateAssetKey } from "./asset-service";
import { MAX_READINGS_PER_BATCH, type ReadingPayload, ingestReadings } from "./telemetry-service";

/** Equipment publishes to poolwatt/v1/assets/<assetId>/readings. */
export const TELEMETRY_TOPIC_FILTER = "poolwatt/v1/assets/+/readings";

const TOPIC_RE = /^poolwatt\/v1\/assets\/([A-Za-z0-9_-]{1,64})\/readings$/;

/** The asset id a topic addresses, or null if the topic is not ours. */
export function parseTopic(topic: string): string | null {
  return TOPIC_RE.exec(topic)?.[1] ?? null;
}

export class MqttMessageError extends Error {}

export interface TelemetryMessage {
  key: string;
  readings: ReadingPayload[];
}

/**
 * `{ "key": "pwt_…", "readings": [{ "intervalStart": "…", "energyKwh": 1.2 }] }`
 *
 * A single reading may also be sent unwrapped, because that is what a small
 * inverter gateway publishes every interval.
 */
export function parseTelemetryMessage(raw: Buffer | string): TelemetryMessage {
  let body: unknown;
  try {
    body = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    throw new MqttMessageError("Payload is not JSON");
  }
  if (typeof body !== "object" || body === null) {
    throw new MqttMessageError("Payload is not an object");
  }

  const record = body as Record<string, unknown>;
  const key = typeof record.key === "string" ? record.key.trim() : "";
  if (!key) throw new MqttMessageError("Payload has no telemetry key");

  const list = Array.isArray(record.readings)
    ? record.readings
    : record.intervalStart !== undefined
      ? [record]
      : null;
  if (!list || list.length === 0) throw new MqttMessageError("Payload has no readings");
  if (list.length > MAX_READINGS_PER_BATCH) {
    throw new MqttMessageError(
      `Batch of ${list.length} exceeds the ${MAX_READINGS_PER_BATCH} interval limit`,
    );
  }

  const readings: ReadingPayload[] = list.map((item, i) => {
    if (typeof item !== "object" || item === null) {
      throw new MqttMessageError(`Reading ${i} is not an object`);
    }
    const r = item as Record<string, unknown>;
    const intervalStart = r.intervalStart ?? r.interval_start ?? r.ts;
    if (typeof intervalStart !== "string" && typeof intervalStart !== "number") {
      throw new MqttMessageError(`Reading ${i} has no intervalStart`);
    }
    const energyKwh = Number(r.energyKwh ?? r.energy_kwh ?? r.kwh);
    if (!Number.isFinite(energyKwh)) {
      throw new MqttMessageError(`Reading ${i} has no numeric energyKwh`);
    }
    const expected = r.expectedKwh ?? r.expected_kwh;
    return {
      intervalStart: typeof intervalStart === "number"
        ? new Date(intervalStart).toISOString()
        : intervalStart,
      energyKwh,
      expectedKwh: expected == null ? null : Number(expected),
    };
  });

  return { key, readings };
}

export type MqttIntakeResult =
  | { status: "ingested"; assetId: string; accepted: number; minted: number; mintedKwh: number }
  | { status: "ignored"; reason: string }
  | { status: "rejected"; reason: string };

/**
 * One broker message. Never throws: a bad message from one gateway must not
 * take the subscriber down for every other asset.
 */
export async function handleTelemetryMessage(args: {
  topic: string;
  payload: Buffer | string;
}): Promise<MqttIntakeResult> {
  const assetId = parseTopic(args.topic);
  if (!assetId) return { status: "ignored", reason: `Topic ${args.topic} is not a telemetry topic` };

  let message: TelemetryMessage;
  try {
    message = parseTelemetryMessage(args.payload);
  } catch (err) {
    return {
      status: "rejected",
      reason: err instanceof Error ? err.message : "Unreadable payload",
    };
  }

  const key = await authenticateAssetKey(message.key);
  if (!key) return { status: "rejected", reason: "Invalid or revoked telemetry key" };
  if (key.assetId !== assetId) {
    // The key is real but belongs to a different asset: someone is publishing
    // on a topic they do not own.
    return { status: "rejected", reason: "Telemetry key does not belong to this asset" };
  }

  try {
    const outcome = await ingestReadings({
      assetId,
      readings: message.readings,
      source: "mqtt",
    });
    return {
      status: "ingested",
      assetId,
      accepted: outcome.accepted,
      minted: outcome.minted,
      mintedKwh: outcome.mintedKwh,
    };
  } catch (err) {
    return {
      status: "rejected",
      reason: err instanceof Error ? err.message : "Ingest failed",
    };
  }
}
