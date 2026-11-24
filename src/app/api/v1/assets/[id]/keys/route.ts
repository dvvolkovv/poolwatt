// POST /v1/assets/{id}/keys — ТЗ §15, US-03. The plaintext key is returned
// exactly once; only its SHA-256 is stored.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { issueAssetKey } from "@/lib/exchange/asset-service";
import { domainError, forbidden, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ label: z.string().max(100).optional().nullable() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  const asset = await prisma.asset.findUnique({
    where: { id },
    include: { company: { select: { ownerUserId: true } } },
  });
  if (!asset) return domainError(new Error("Asset not found"));
  if (asset.company.ownerUserId !== user.id && user.role !== "ADMIN") return forbidden();

  try {
    const { key, plaintext, signingSecret } = await issueAssetKey({
      assetId: id,
      label: parsed.data.label ?? null,
      actorUserId: user.id,
    });
    return ok(
      {
        key: { id: key.id, prefix: key.prefix, label: key.label },
        // Both shown once — the client must store them now (§15).
        plaintext,
        signingSecret,
      },
      201,
    );
  } catch (err) {
    return domainError(err);
  }
}
