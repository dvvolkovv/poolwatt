// POST /v1/telemetry/readings — ТЗ §15, US-03, US-04, §17.
//
// Equipment auth, not user auth: the Bearer token is the asset's telemetry key
// (POST /v1/assets/{id}/keys), so the asset identity comes from the key rather
// than from the body. A batch carries up to 1000 intervals (§15).
import type { NextRequest } from "next/server";
import { z } from "zod";
import { authenticateAssetKey } from "@/lib/exchange/asset-service";
import {
  bearerToken,
  domainError,
  fail,
  idempotencyKey,
  idempotent,
  parseBody,
} from "@/lib/exchange/api";
import { MAX_READINGS_PER_BATCH, ingestReadings } from "@/lib/exchange/telemetry-service";

const bodySchema = z.object({
  readings: z
    .array(
      z.object({
        intervalStart: z.string().min(4),
        energyKwh: z.number().finite().min(-1).max(10_000_000),
        expectedKwh: z.number().finite().nonnegative().optional().nullable(),
      }),
    )
    .min(1)
    .max(MAX_READINGS_PER_BATCH),
  source: z.enum(["rest", "mqtt", "manual"]).optional(),
});

export async function POST(req: NextRequest) {
  const token = bearerToken(req);
  if (!token) return fail("Missing Bearer telemetry key", 401);

  const key = await authenticateAssetKey(token);
  if (!key) return fail("Invalid or revoked telemetry key", 401);

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  try {
    return await idempotent({
      endpoint: "POST /v1/telemetry/readings",
      key: idempotencyKey(req),
      // Equipment, not a person: the key identifies the caller (§15).
      userKey: key.id,
      body: parsed.data,
      run: async () => {
        const outcome = await ingestReadings({
          assetId: key.assetId,
          readings: parsed.data.readings,
          source: parsed.data.source ?? "rest",
        });
        return { status: 202, data: { assetId: key.assetId, outcome } };
      },
    });
  } catch (err) {
    return domainError(err);
  }
}
