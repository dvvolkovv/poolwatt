// MQTT telemetry intake — ТЗ §4, §12 US-03.

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { issueAssetKey, revokeAssetKey } from "./asset-service";
import {
  MqttMessageError,
  handleTelemetryMessage,
  parseTelemetryMessage,
  parseTopic,
} from "./mqtt-telemetry";

const PREFIX = "test_mqtt_";
const ZONE = "TESTMQTT";

let zoneId: string;
let companyId: string;
let assetId: string;
let otherAssetId: string;
let assetKey: string;
let otherKey: string;

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { actor: { startsWith: PREFIX } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.meterReading.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  const owner = await prisma.user.create({
    data: { username: PREFIX + "owner", passwordHash: "x" },
  });
  zoneId = (
    await prisma.gridZone.create({
      data: {
        code: ZONE, country: "SK", name: ZONE, currency: "EUR", intervalMinutes: 15,
        corridorPct: new Prisma.Decimal(30), spotPrice: new Prisma.Decimal(0.2),
      },
    })
  ).id;
  companyId = (
    await prisma.company.create({
      data: {
        legalName: PREFIX + "Co", country: "SK", regNumber: PREFIX + "reg",
        type: "PRODUCER", kybStatus: "APPROVED", ownerUserId: owner.id,
      },
    })
  ).id;

  const make = (name: string) =>
    prisma.asset.create({
      data: {
        companyId, kind: "SOLAR", name, capacityKw: new Prisma.Decimal(20),
        gridZoneId: zoneId, status: "ACTIVE", activatedAt: new Date(),
        telemetryCleanSince: new Date(Date.now() - 30 * 864e5),
      },
    });
  assetId = (await make("A")).id;
  otherAssetId = (await make("B")).id;
  assetKey = (await issueAssetKey({ assetId, actorUserId: PREFIX + "owner" })).plaintext;
  otherKey = (await issueAssetKey({ assetId: otherAssetId, actorUserId: PREFIX + "owner" })).plaintext;
});

afterAll(cleanup);

beforeEach(async () => {
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.meterReading.deleteMany({ where: { zone: { code: ZONE } } });
});

const topic = (id: string) => `poolwatt/v1/assets/${id}/readings`;
const INTERVAL = "2026-11-24T10:00:00.000Z";

describe("parseTopic", () => {
  it("picks the asset out of our topic", () => {
    expect(parseTopic(topic("abc123"))).toBe("abc123");
  });

  it("ignores every other topic", () => {
    for (const t of [
      "poolwatt/v1/assets/abc/commands",
      "poolwatt/v1/assets//readings",
      "poolwatt/v2/assets/abc/readings",
      "$SYS/broker/load",
      "poolwatt/v1/assets/../../etc/readings",
    ]) {
      expect(parseTopic(t), t).toBeNull();
    }
  });
});

describe("parseTelemetryMessage", () => {
  it("reads a batch", () => {
    const m = parseTelemetryMessage(
      JSON.stringify({ key: "pwt_x", readings: [{ intervalStart: INTERVAL, energyKwh: 2.5 }] }),
    );
    expect(m.key).toBe("pwt_x");
    expect(m.readings).toEqual([{ intervalStart: INTERVAL, energyKwh: 2.5, expectedKwh: null }]);
  });

  it("reads the single-interval shape a small gateway publishes", () => {
    const m = parseTelemetryMessage(
      JSON.stringify({ key: "pwt_x", intervalStart: INTERVAL, energyKwh: 1 }),
    );
    expect(m.readings).toHaveLength(1);
    expect(m.readings[0].energyKwh).toBe(1);
  });

  it("accepts snake_case and an epoch timestamp, as gateways send them", () => {
    const ms = Date.parse(INTERVAL);
    const m = parseTelemetryMessage(
      JSON.stringify({ key: "pwt_x", readings: [{ ts: ms, energy_kwh: "3.5", expected_kwh: 4 }] }),
    );
    expect(m.readings[0]).toEqual({
      intervalStart: INTERVAL,
      energyKwh: 3.5,
      expectedKwh: 4,
    });
  });

  it("refuses a payload with no key, no readings or no numbers", () => {
    const bad = [
      "not json",
      JSON.stringify([1, 2]),
      JSON.stringify({ readings: [{ intervalStart: INTERVAL, energyKwh: 1 }] }),
      JSON.stringify({ key: "pwt_x" }),
      JSON.stringify({ key: "pwt_x", readings: [] }),
      JSON.stringify({ key: "pwt_x", readings: [{ energyKwh: 1 }] }),
      JSON.stringify({ key: "pwt_x", readings: [{ intervalStart: INTERVAL }] }),
      JSON.stringify({ key: "pwt_x", readings: [{ intervalStart: INTERVAL, energyKwh: "abc" }] }),
    ];
    for (const payload of bad) {
      expect(() => parseTelemetryMessage(payload), payload).toThrow(MqttMessageError);
    }
  });

  it("refuses more than the 1000 intervals of §15", () => {
    const readings = Array.from({ length: 1001 }, (_, i) => ({
      intervalStart: new Date(Date.parse(INTERVAL) + i * 900_000).toISOString(),
      energyKwh: 1,
    }));
    expect(() => parseTelemetryMessage(JSON.stringify({ key: "pwt_x", readings }))).toThrow(
      /1000/,
    );
  });
});

describe("handleTelemetryMessage — US-03", () => {
  const send = (id: string, payload: unknown, raw?: string) =>
    handleTelemetryMessage({ topic: topic(id), payload: raw ?? JSON.stringify(payload) });

  it("ingests and mints a valid message", async () => {
    const result = await send(assetId, {
      key: assetKey,
      readings: [{ intervalStart: INTERVAL, energyKwh: 2.5 }],
    });

    expect(result).toEqual({
      status: "ingested",
      assetId,
      accepted: 1,
      minted: 1,
      mintedKwh: 2.5,
    });
    const reading = await prisma.meterReading.findFirstOrThrow({ where: { assetId } });
    expect(reading.source).toBe("mqtt");
    expect(reading.validationStatus).toBe("VALID");
  });

  it("refuses a key that belongs to another asset", async () => {
    const result = await send(assetId, {
      key: otherKey,
      readings: [{ intervalStart: INTERVAL, energyKwh: 2.5 }],
    });
    expect(result).toEqual({
      status: "rejected",
      reason: "Telemetry key does not belong to this asset",
    });
    expect(await prisma.meterReading.count({ where: { assetId } })).toBe(0);
  });

  it("refuses a revoked key", async () => {
    const { key, plaintext } = await issueAssetKey({ assetId, actorUserId: PREFIX + "owner" });
    await revokeAssetKey({ keyId: key.id, actorUserId: PREFIX + "owner" });
    const result = await send(assetId, {
      key: plaintext,
      readings: [{ intervalStart: INTERVAL, energyKwh: 1 }],
    });
    expect(result.status).toBe("rejected");
    expect(await prisma.meterReading.count({ where: { assetId } })).toBe(0);
  });

  it("ignores a topic that is not ours instead of erroring", async () => {
    const result = await handleTelemetryMessage({
      topic: "$SYS/broker/uptime",
      payload: "up 3 days",
    });
    expect(result.status).toBe("ignored");
  });

  it("never throws on a malformed payload", async () => {
    const result = await send(assetId, null, "}{");
    expect(result).toEqual({ status: "rejected", reason: "Payload is not JSON" });
  });

  it("is idempotent on a replayed interval, as §16.2 requires", async () => {
    const payload = { key: assetKey, readings: [{ intervalStart: INTERVAL, energyKwh: 2.5 }] };
    await send(assetId, payload);
    const again = await send(assetId, payload);

    expect(again).toMatchObject({ status: "ingested", accepted: 0, minted: 0 });
    expect(await prisma.meterReading.count({ where: { assetId } })).toBe(1);
    expect(await prisma.energyToken.count({ where: { assetId } })).toBe(1);
  });
});
