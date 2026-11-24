// MQTT subscriber for asset telemetry — ТЗ §4, §12 US-03.
//
// Started by the worker when MQTT_URL is set, so a box without a broker runs
// exactly as before. One shared connection subscribes to the wildcard topic;
// the asset identity comes from the key inside each message, not from the
// broker (see src/lib/exchange/mqtt-telemetry.ts).

import mqtt, { type MqttClient } from "mqtt";
import {
  TELEMETRY_TOPIC_FILTER,
  handleTelemetryMessage,
} from "@/lib/exchange/mqtt-telemetry";

function log(...args: unknown[]) {
  console.log("[worker:mqtt]", ...args);
}

export function startTelemetrySubscriber(): MqttClient | null {
  const url = process.env.MQTT_URL;
  if (!url) {
    log("MQTT_URL not set, telemetry over MQTT is off (REST intake is unaffected)");
    return null;
  }

  const client = mqtt.connect(url, {
    clientId: `poolwatt-worker-${process.pid}`,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    reconnectPeriod: 5_000,
    // The broker is transport, not a queue we own: a clean session avoids a
    // restart replaying hours of intervals that were already minted.
    clean: true,
  });

  client.on("connect", () => {
    client.subscribe(TELEMETRY_TOPIC_FILTER, { qos: 1 }, (err) => {
      if (err) console.error("[worker:mqtt] subscribe failed:", err);
      else log(`connected to ${url}, subscribed to ${TELEMETRY_TOPIC_FILTER}`);
    });
  });

  client.on("message", (topic, payload) => {
    void (async () => {
      const result = await handleTelemetryMessage({ topic, payload });
      if (result.status === "ingested") {
        if (result.minted > 0 || result.accepted > 0) {
          log(
            `${result.assetId}: accepted=${result.accepted} minted=${result.minted} kwh=${result.mintedKwh}`,
          );
        }
      } else if (result.status === "rejected") {
        // Rejections are the interesting signal: a wrong key or a broken
        // gateway shows up here and nowhere else.
        console.error(`[worker:mqtt] ${topic} rejected: ${result.reason}`);
      }
    })();
  });

  client.on("error", (err) => {
    console.error("[worker:mqtt] client error:", err.message);
  });

  return client;
}
