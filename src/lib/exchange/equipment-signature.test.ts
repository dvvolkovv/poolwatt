// ТЗ §15 — "API-ключи с подписью HMAC для оборудования и партнёров".

import { describe, it, expect } from "vitest";
import {
  SIGNATURE_WINDOW_SECONDS,
  mqttCanonicalString,
  restCanonicalString,
  signCanonical,
  verifySignature,
} from "./equipment-signature";

const SECRET = "pws_0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-11-24T12:00:00.000Z");
const TS = Math.floor(NOW.getTime() / 1000);
const BODY = JSON.stringify({
  readings: [{ intervalStart: "2026-11-24T11:45:00.000Z", energyKwh: 4.125 }],
});

function sign(canonical: string) {
  return signCanonical(SECRET, canonical);
}

describe("canonical strings", () => {
  it("binds a REST signature to the method, the path and the exact body", () => {
    const canonical = restCanonicalString({
      timestamp: TS,
      method: "post",
      path: "/api/v1/telemetry/readings",
      body: BODY,
    });
    expect(canonical).toContain(`v1.${TS}.POST./api/v1/telemetry/readings.`);
    // The body is present only as its digest, never verbatim.
    expect(canonical).not.toContain("energyKwh");

    const other = restCanonicalString({
      timestamp: TS,
      method: "post",
      path: "/api/v1/telemetry/readings",
      body: BODY.replace("4.125", "41.25"),
    });
    expect(other).not.toBe(canonical);
  });

  it("binds an MQTT signature to the topic and to every reading", () => {
    const canonical = mqttCanonicalString({
      timestamp: TS,
      topic: "poolwatt/v1/assets/a1/readings",
      readings: [{ intervalStart: "2026-11-24T11:45:00.000Z", energyKwh: 4.125 }],
    });
    expect(canonical).toBe(
      `v1.${TS}.MQTT.poolwatt/v1/assets/a1/readings.2026-11-24T11:45:00.000Z:4.125`,
    );
  });

  it("joins several MQTT readings in the order they were sent", () => {
    const canonical = mqttCanonicalString({
      timestamp: TS,
      topic: "t",
      readings: [
        { intervalStart: "2026-11-24T11:45:00.000Z", energyKwh: 1 },
        { intervalStart: "2026-11-24T12:00:00.000Z", energyKwh: 2.5 },
      ],
    });
    expect(canonical).toBe(
      `v1.${TS}.MQTT.t.2026-11-24T11:45:00.000Z:1.000;2026-11-24T12:00:00.000Z:2.500`,
    );
  });
});

describe("verifySignature", () => {
  const canonical = restCanonicalString({
    timestamp: TS,
    method: "POST",
    path: "/api/v1/telemetry/readings",
    body: BODY,
  });

  it("accepts a signature made with the right secret", () => {
    const result = verifySignature({
      secret: SECRET,
      signature: sign(canonical),
      timestamp: TS,
      canonical,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts the bare hex form as well as v1=", () => {
    const hex = sign(canonical).replace("v1=", "");
    expect(
      verifySignature({ secret: SECRET, signature: hex, timestamp: TS, canonical, now: NOW }).ok,
    ).toBe(true);
  });

  it("rejects a signature made with another secret", () => {
    const result = verifySignature({
      secret: SECRET,
      signature: signCanonical("pws_someone_elses_secret", canonical),
      timestamp: TS,
      canonical,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "Signature does not match" });
  });

  it("rejects a signature over a different body", () => {
    const tampered = restCanonicalString({
      timestamp: TS,
      method: "POST",
      path: "/api/v1/telemetry/readings",
      body: BODY.replace("4.125", "41.25"),
    });
    const result = verifySignature({
      secret: SECRET,
      signature: sign(canonical),
      timestamp: TS,
      canonical: tampered,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a replay from outside the time window", () => {
    const stale = TS - SIGNATURE_WINDOW_SECONDS - 1;
    const staleCanonical = restCanonicalString({
      timestamp: stale,
      method: "POST",
      path: "/api/v1/telemetry/readings",
      body: BODY,
    });
    const result = verifySignature({
      secret: SECRET,
      signature: sign(staleCanonical),
      timestamp: stale,
      canonical: staleCanonical,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "Signature timestamp is outside the ±300 s window" });
  });

  it("rejects a timestamp too far in the future", () => {
    const ahead = TS + SIGNATURE_WINDOW_SECONDS + 1;
    const aheadCanonical = restCanonicalString({
      timestamp: ahead,
      method: "POST",
      path: "/api/v1/telemetry/readings",
      body: BODY,
    });
    expect(
      verifySignature({
        secret: SECRET,
        signature: sign(aheadCanonical),
        timestamp: ahead,
        canonical: aheadCanonical,
        now: NOW,
      }).ok,
    ).toBe(false);
  });

  it("rejects a missing or unreadable signature", () => {
    expect(
      verifySignature({ secret: SECRET, signature: null, timestamp: TS, canonical, now: NOW }),
    ).toEqual({ ok: false, reason: "Missing X-Poolwatt-Signature header" });
    expect(
      verifySignature({ secret: SECRET, signature: "v1=zz", timestamp: TS, canonical, now: NOW }).ok,
    ).toBe(false);
  });

  it("rejects a missing or unreadable timestamp", () => {
    expect(
      verifySignature({
        secret: SECRET,
        signature: sign(canonical),
        timestamp: null,
        canonical,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "Missing X-Poolwatt-Timestamp header" });
    expect(
      verifySignature({
        secret: SECRET,
        signature: sign(canonical),
        timestamp: "not-a-number",
        canonical,
        now: NOW,
      }).ok,
    ).toBe(false);
  });
});
