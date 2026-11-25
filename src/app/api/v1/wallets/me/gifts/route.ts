// GET /v1/wallets/me/gifts — ТЗ §45, US-42.
import { ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { readMyGifts } from "@/lib/marketing/grant-spend";

export async function GET() {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const gifts = await readMyGifts(user.id);
  return ok({
    gifts: gifts.map((g) => ({
      id: g.id,
      network: { id: g.operatorId, slug: g.operatorSlug, name: g.networkName },
      campaign: g.campaignName,
      amountKwh: g.amountKwh,
      remainingKwh: g.remainingKwh,
      expiresAt: g.expiresAt.toISOString(),
      pointCount: g.pointCount,
      // §43 — a gift cannot be transferred, sold or cashed out, and saying so
      // in the payload keeps a client from building a button for it.
      transferable: false,
      sellable: false,
    })),
    totalRemainingKwh: gifts.reduce((sum, g) => sum + g.remainingKwh, 0),
  });
}
