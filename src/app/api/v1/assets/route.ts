// POST /v1/assets — ТЗ §15, US-03.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createAsset } from "@/lib/exchange/asset-service";
import { domainError, forbidden, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { num } from "@/lib/exchange/decimal";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  companyId: z.string().min(1),
  kind: z.enum(["SOLAR", "WIND", "BIOGAS", "HYDRO", "STORAGE", "MIXED"]),
  name: z.string().min(2).max(160),
  capacityKw: z.number().positive().max(1_000_000),
  storageKwh: z.number().positive().max(10_000_000).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  gridZoneId: z.string().min(1),
  meterId: z.string().max(100).optional().nullable(),
  goCertificateRef: z.string().max(200).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  const company = await prisma.company.findUnique({ where: { id: parsed.data.companyId } });
  if (!company) return domainError(new Error("Company not found"));
  if (company.ownerUserId !== user.id && user.role !== "ADMIN") return forbidden();

  try {
    const asset = await createAsset({ ...parsed.data, actorUserId: user.id });
    return ok(
      {
        asset: {
          id: asset.id,
          kind: asset.kind,
          name: asset.name,
          capacityKw: num(asset.capacityKw),
          status: asset.status,
          gridZoneId: asset.gridZoneId,
        },
      },
      201,
    );
  } catch (err) {
    return domainError(err);
  }
}
