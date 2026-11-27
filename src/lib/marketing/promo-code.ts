// §42's promo-code trigger: "регистрация по QR-коду или промокоду партнёра".
//
// The driver types a code (or arrives on the link the QR sticker carries) and
// the gift is issued there and then — no charge, no worker pass. Everything
// else about it is the gift constructor as it already works: the budget, the
// once-per-client rule, the expiry and the audit entry all come from
// `issueGrantTx`.
//
// An existing client of the network may redeem a code too. Refusing them
// would mean the sticker on the charger works for newcomers only, while §42
// promises the gift to whoever comes in with the code.

import { prisma } from "@/lib/prisma";
import { issueCampaignGifts } from "./campaign-engine";

export class PromoCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromoCodeError";
  }
}

export interface RedeemedCode {
  campaignId: string;
  campaignName: string;
  networkName: string;
  operatorSlug: string;
  grantIds: string[];
}

/** Codes are stored and compared upper-case, so case never decides anything. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Redeem a code for this driver.
 *
 * Throws when the code is not a code, when its campaign is not running, and
 * when this driver has already had it: the driver typed something and
 * deserves to be told which of those happened.
 */
export async function redeemPromoCode(userId: string, raw: string): Promise<RedeemedCode> {
  const code = normalizePromoCode(raw);
  if (code.length < 3) throw new PromoCodeError("That code is too short");

  const campaign = await prisma.campaign.findUnique({
    where: { promoCode: code },
    include: { operator: { select: { displayName: true, slug: true } } },
  });
  if (!campaign || campaign.trigger !== "PROMO_CODE") {
    throw new PromoCodeError("No such code");
  }

  const now = new Date();
  if (campaign.status === "EXHAUSTED") {
    throw new PromoCodeError("This campaign has given out everything it had");
  }
  if (campaign.status !== "ACTIVE") {
    throw new PromoCodeError("This code is not active");
  }
  if (campaign.startsAt && campaign.startsAt > now) {
    throw new PromoCodeError("This code is not active yet");
  }
  if (campaign.endsAt && campaign.endsAt < now) {
    throw new PromoCodeError("This code has expired");
  }

  // No payment: the gift is earned by the code itself. A second attempt by
  // the same driver issues nothing, because "один раз на клиента" is a unique
  // index on (campaign, driver, key).
  const grantIds = await issueCampaignGifts(campaign, userId, null);
  if (grantIds.length === 0) {
    const already = await prisma.promoGrant.findFirst({
      where: { campaignId: campaign.id, userId },
      select: { id: true },
    });
    throw new PromoCodeError(
      already ? "You have already used this code" : "This campaign has nothing left to give",
    );
  }

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    networkName: campaign.operator.displayName,
    operatorSlug: campaign.operator.slug,
    grantIds,
  };
}
