import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashToken, looksLikeToken } from "@/lib/charger-operator-tokens";

const bodySchema = z.object({
  pricePerKwh: z.number().positive().max(99.9999),
  currency: z.enum(["EUR", "USD", "GBP", "CZK", "PLN", "CHF", "RUB", "UAH"]),
});

function unauthorized(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 401 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: operatorId } = await params;

  // Auth: Bearer token from Authorization header.
  const authHeader = req.headers.get("authorization") ?? "";
  const m = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!m) return unauthorized("Missing Bearer token");
  const plaintext = m[1];
  if (!looksLikeToken(plaintext)) return unauthorized("Malformed token");

  const tokenHash = hashToken(plaintext);
  const key = await prisma.chargerOperatorApiKey.findUnique({
    where: { tokenHash },
    select: { id: true, operatorId: true, revokedAt: true },
  });
  if (!key || key.revokedAt) return unauthorized("Invalid or revoked token");
  if (key.operatorId !== operatorId) {
    return NextResponse.json(
      { ok: false, error: "Token does not match this operator" },
      { status: 403 },
    );
  }

  // Body validation.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid body", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // Apply price + bump lastUsedAt on the key.
  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.chargerOperator.update({
      where: { id: operatorId },
      data: {
        pricePerKwh: parsed.data.pricePerKwh,
        priceCurrency: parsed.data.currency,
        priceUpdatedAt: now,
      },
      select: { id: true, priceUpdatedAt: true },
    }),
    prisma.chargerOperatorApiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: now },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    operatorId: updated.id,
    updatedAt: updated.priceUpdatedAt?.toISOString() ?? now.toISOString(),
  });
}
