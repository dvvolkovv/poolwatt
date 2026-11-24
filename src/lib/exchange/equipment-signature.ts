// HMAC signatures for equipment and partners — ТЗ §15 ("API-ключи с подписью
// HMAC для оборудования и партнёров").
//
// A bearer key alone proves only that the sender once learned the key. A
// signature proves that this particular message was produced by the holder of
// the secret and has not been edited on the way: without it, anything able to
// see or replay a request could change the kWh in it, and §5 counts on the
// reading being what the meter said.
//
// The gateway signs a canonical string, never the raw bytes, so both sides
// agree on what was signed:
//
//   REST   v1.<unix seconds>.<METHOD>.<path>.<sha256 hex of the request body>
//   MQTT   v1.<unix seconds>.MQTT.<topic>.<interval>:<kWh>;<interval>:<kWh>…
//
// and sends `X-Poolwatt-Timestamp` plus `X-Poolwatt-Signature: v1=<hex>`
// (MQTT: the `ts` and `sig` fields of the message). Replays inside the time
// window are stopped by the idempotency key (§15), which every telemetry POST
// must carry anyway.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** How far a signature's clock may drift from ours. */
export const SIGNATURE_WINDOW_SECONDS = 300;

export const TIMESTAMP_HEADER = "x-poolwatt-timestamp";
export const SIGNATURE_HEADER = "x-poolwatt-signature";

export function restCanonicalString(args: {
  timestamp: number | string;
  method: string;
  path: string;
  body: string;
}): string {
  const digest = createHash("sha256").update(args.body, "utf8").digest("hex");
  return `v1.${args.timestamp}.${args.method.toUpperCase()}.${args.path}.${digest}`;
}

export interface SignedReading {
  intervalStart: string;
  energyKwh: number;
}

export function mqttCanonicalString(args: {
  timestamp: number | string;
  topic: string;
  readings: SignedReading[];
}): string {
  // §16.1 stores kWh to 0,001, so three decimals is the whole value.
  const body = args.readings
    .map((r) => `${r.intervalStart}:${r.energyKwh.toFixed(3)}`)
    .join(";");
  return `v1.${args.timestamp}.MQTT.${args.topic}.${body}`;
}

/** The value a gateway puts in the signature header. */
export function signCanonical(secret: string, canonical: string): string {
  return `v1=${createHmac("sha256", secret).update(canonical, "utf8").digest("hex")}`;
}

export type SignatureVerdict = { ok: true } | { ok: false; reason: string };

export function verifySignature(args: {
  secret: string;
  signature: string | null | undefined;
  timestamp: string | number | null | undefined;
  canonical: string;
  now?: Date;
}): SignatureVerdict {
  if (!args.signature) return { ok: false, reason: `Missing X-Poolwatt-Signature header` };
  if (args.timestamp == null || args.timestamp === "") {
    return { ok: false, reason: `Missing X-Poolwatt-Timestamp header` };
  }

  const seconds = Number(args.timestamp);
  if (!Number.isFinite(seconds)) {
    return { ok: false, reason: "Signature timestamp is not a number" };
  }
  const nowSeconds = Math.floor((args.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - seconds) > SIGNATURE_WINDOW_SECONDS) {
    return {
      ok: false,
      reason: `Signature timestamp is outside the ±${SIGNATURE_WINDOW_SECONDS} s window`,
    };
  }

  const presented = args.signature.trim().replace(/^v1=/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(presented)) {
    return { ok: false, reason: "Signature is not a v1 hex digest" };
  }

  const expected = signCanonical(args.secret, args.canonical).slice(3);
  // Constant time: a timing oracle on a signature is a signature forgery.
  const same = timingSafeEqual(Buffer.from(presented, "hex"), Buffer.from(expected, "hex"));
  return same ? { ok: true } : { ok: false, reason: "Signature does not match" };
}
