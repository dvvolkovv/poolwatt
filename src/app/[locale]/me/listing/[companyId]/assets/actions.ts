"use server";

// Assets and monitoring in the producer cabinet — ТЗ §4, §12 US-03, §30.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  AssetError,
  createAsset,
  issueAssetKey,
  revokeAssetKey,
  updateSaleRules,
} from "@/lib/exchange/asset-service";
import { prisma } from "@/lib/prisma";

export type AssetActionResult = {
  ok: boolean;
  assetId?: string;
  /** Returned exactly once, when a key is issued. */
  plaintext?: string;
  /** §15 signing secret, also exactly once. Null when none was issued. */
  signingSecret?: string | null;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

const assetSchema = z.object({
  kind: z.enum(["SOLAR", "WIND", "BIOGAS", "HYDRO", "STORAGE", "MIXED"]),
  name: z.string().trim().min(2).max(160),
  capacityKw: z.number().positive().max(1_000_000),
  storageKwh: z.number().positive().max(10_000_000).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  gridZoneId: z.string().min(1),
  meterId: z.string().trim().max(100).optional().nullable(),
  goCertificateRef: z.string().trim().max(200).optional().nullable(),
});

export type AssetInput = z.input<typeof assetSchema>;

const rulesSchema = z.object({
  minSalePrice: z.number().min(0).max(100).optional().nullable(),
  shareToMarketPct: z.number().int().min(0).max(100),
  shareToStoragePct: z.number().int().min(0).max(100),
  shareToSelfPct: z.number().int().min(0).max(100),
});

export type SaleRulesInput = z.input<typeof rulesSchema>;

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) out[key] = issue.message;
  }
  return out;
}

async function ownedCompany(companyId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated." as const };
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, ownerUserId: true },
  });
  if (!company) return { error: "Company not found." as const };
  if (company.ownerUserId !== session.user.id && session.user.role !== "ADMIN") {
    return { error: "This company belongs to someone else." as const };
  }
  return { companyId, userId: session.user.id };
}

/** The asset plus the id of the company that owns it, if the caller may act. */
async function ownedAsset(assetId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated." as const };
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { id: true, companyId: true, company: { select: { ownerUserId: true } } },
  });
  if (!asset) return { error: "Asset not found." as const };
  if (asset.company.ownerUserId !== session.user.id && session.user.role !== "ADMIN") {
    return { error: "This asset belongs to someone else." as const };
  }
  return { asset, userId: session.user.id };
}

function refreshAssets() {
  revalidatePath("/[locale]/me/listing/[companyId]/assets", "page");
}

/** US-03 — a generation object joins the company. */
export async function addAsset(
  companyId: string,
  input: AssetInput,
): Promise<AssetActionResult> {
  const guard = await ownedCompany(companyId);
  if ("error" in guard) return { ok: false, formError: guard.error };

  const parsed = assetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  try {
    const asset = await createAsset({
      ...parsed.data,
      companyId,
      actorUserId: guard.userId,
    });
    refreshAssets();
    return { ok: true, assetId: asset.id };
  } catch (err) {
    if (err instanceof AssetError) return { ok: false, formError: err.message };
    const message = err instanceof Error ? err.message : String(err);
    if (/Unique constraint/i.test(message) && /meterId/.test(message)) {
      return { ok: false, fieldErrors: { meterId: "This meter is already registered." } };
    }
    return { ok: false, formError: message.slice(0, 300) };
  }
}

/** US-03 — "Выдача API-ключа объекта". Shown once, never stored in the clear. */
export async function issueKey(
  assetId: string,
  label: string | null,
): Promise<AssetActionResult> {
  const guard = await ownedAsset(assetId);
  if ("error" in guard) return { ok: false, formError: guard.error };

  try {
    const { plaintext, signingSecret } = await issueAssetKey({
      assetId,
      label,
      actorUserId: guard.userId,
    });
    refreshAssets();
    return { ok: true, assetId, plaintext, signingSecret };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Key issue failed." };
  }
}

export async function revokeKey(assetId: string, keyId: string): Promise<AssetActionResult> {
  const guard = await ownedAsset(assetId);
  if ("error" in guard) return { ok: false, formError: guard.error };

  const key = await prisma.assetApiKey.findUnique({
    where: { id: keyId },
    select: { assetId: true },
  });
  if (!key || key.assetId !== assetId) return { ok: false, formError: "Key not found." };

  try {
    await revokeAssetKey({ keyId, actorUserId: guard.userId });
    refreshAssets();
    return { ok: true, assetId };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Revoke failed." };
  }
}

/** §30 — min sale price and the market / storage / self split. */
export async function saveSaleRules(
  assetId: string,
  input: SaleRulesInput,
): Promise<AssetActionResult> {
  const guard = await ownedAsset(assetId);
  if ("error" in guard) return { ok: false, formError: guard.error };

  const parsed = rulesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  try {
    await updateSaleRules({
      assetId,
      minSalePrice: parsed.data.minSalePrice ?? null,
      shareToMarketPct: parsed.data.shareToMarketPct,
      shareToStoragePct: parsed.data.shareToStoragePct,
      shareToSelfPct: parsed.data.shareToSelfPct,
      actorUserId: guard.userId,
    });
    refreshAssets();
    return { ok: true, assetId };
  } catch (err) {
    if (err instanceof AssetError) return { ok: false, formError: err.message };
    return { ok: false, formError: err instanceof Error ? err.message : "Save failed." };
  }
}
