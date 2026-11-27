// The gift constructor of §42, as the partner fills it in.
//
// Validation lives here and nowhere else, so the cabinet form and any future
// `POST /v1/campaigns` caller are held to the same rules. The engine
// (`campaign-engine.ts`) trusts what this file wrote.

import type { CampaignStatus, CampaignTrigger, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCampaignFiatFundingOpen } from "@/lib/exchange/gates";
import { num, numOrNull } from "@/lib/exchange/decimal";
import { roundKwh } from "@/lib/exchange/precision";
import { normalizePromoCode } from "./promo-code";

export class CampaignError extends Error {}

export interface CampaignInput {
  name: string;
  trigger: CampaignTrigger;
  triggerN?: number | null;
  triggerPeriodDays?: number | null;
  giftKwh: number;
  /** §8, US-12 — the share of a token-paid session a TOKEN_PAYMENT campaign returns. */
  cashbackPct?: number | null;
  scopePointIds?: string[];
  validityDays: number;
  oncePerClient?: boolean;
  minNextChargeKwh?: number | null;
  /** §42 "не суммируется с другими акциями". */
  exclusive?: boolean;
  /** §42 "скидка в % на следующую зарядку"; `giftKwh` is then its ceiling. */
  discountPct?: number | null;
  /** §42 "бесплатная бронь", on its own or next to the energy gift. */
  freeBooking?: boolean;
  /** §42 "регистрация по QR-коду или промокоду партнёра". */
  promoCode?: string | null;
  budgetKwh: number;
  /** The count ceiling, which is what a free booking is measured in. */
  budgetGrants?: number | null;
  fundingSource?: "TOKENS" | "FIAT";
  zoneId: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

async function requireNetwork(operatorId: string, userId: string) {
  const op = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { id: true, claimedById: true },
  });
  if (!op) throw new CampaignError("No such network");
  if (!op.claimedById || op.claimedById !== userId) {
    throw new CampaignError("This network belongs to somebody else");
  }
  return op;
}

async function requireOwnedCampaign(campaignId: string, userId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { operator: { select: { claimedById: true } } },
  });
  if (!campaign) throw new CampaignError("No such campaign");
  if (campaign.operator.claimedById !== userId) {
    throw new CampaignError("This campaign belongs to somebody else");
  }
  return campaign;
}

async function validate(
  operatorId: string,
  input: Partial<CampaignInput>,
  current?: {
    id?: string;
    trigger: CampaignTrigger;
    giftKwh: Prisma.Decimal;
    budgetKwh: Prisma.Decimal;
    cashbackPct: Prisma.Decimal | null;
    oncePerClient: boolean;
    freeBooking?: boolean;
    discountPct?: Prisma.Decimal | null;
    promoCode?: string | null;
  },
): Promise<void> {
  if (input.fundingSource === "FIAT") {
    // §42's money half needs the EMI; the gate says so rather than us
    // pretending a reserve exists.
    assertCampaignFiatFundingOpen();
  }

  const gift = input.giftKwh ?? (current ? num(current.giftKwh) : undefined);
  const budget = input.budgetKwh ?? (current ? num(current.budgetKwh) : undefined);
  const trigger = input.trigger ?? current?.trigger;
  const cashback =
    input.cashbackPct !== undefined
      ? input.cashbackPct
      : current
        ? numOrNull(current.cashbackPct)
        : undefined;

  // US-12 — a cashback campaign is priced in percent, a gift campaign in kWh.
  // Each needs its own number and neither needs the other's.
  if (trigger === "TOKEN_PAYMENT") {
    if (!(cashback != null && cashback > 0)) {
      throw new CampaignError("A cashback campaign needs a share bigger than zero");
    }
    if (cashback > 100) {
      throw new CampaignError("A cashback share cannot be more than 100 %");
    }
    const once = input.oncePerClient ?? current?.oncePerClient ?? false;
    if (once) {
      throw new CampaignError(
        "Cashback is earned by every token payment, so it cannot be once per client",
      );
    }
  } else {
    // §42 "комбинация" — a campaign that gives a free booking does not have
    // to give energy as well, so zero kWh is a complete gift on its own.
    const booking = input.freeBooking ?? current?.freeBooking ?? false;
    if (gift !== undefined && !(gift > 0) && !booking) {
      throw new CampaignError("The gift has to be more than zero kWh, or a free booking");
    }
  }

  if (
    trigger !== "TOKEN_PAYMENT" &&
    budget !== undefined &&
    gift !== undefined &&
    gift > 0 &&
    roundKwh(budget) < roundKwh(gift)
  ) {
    throw new CampaignError("The budget is smaller than a single gift");
  }

  // §42 "скидка в % на следующую зарядку". The percentage is what the driver
  // sees; the kWh gift is the ceiling the partner is willing to cover, and
  // without one a discount would have no limit at all.
  const discount =
    input.discountPct !== undefined
      ? input.discountPct
      : current
        ? numOrNull(current.discountPct ?? null)
        : undefined;
  if (discount != null) {
    if (!(discount > 0) || discount > 100) {
      throw new CampaignError("A discount has to be between 0 and 100 %");
    }
    if (trigger === "TOKEN_PAYMENT") {
      throw new CampaignError("A cashback campaign is already a share, so it takes no discount");
    }
    if (gift !== undefined && !(gift > 0)) {
      throw new CampaignError("A discount needs a ceiling in kWh the partner will cover");
    }
  }

  // §42's count ceiling. A free booking costs no kWh, so without it the
  // campaign would never stop.
  const booking = input.freeBooking ?? current?.freeBooking ?? false;
  const countBudget =
    input.budgetGrants !== undefined ? input.budgetGrants : undefined;
  if (booking && current === undefined && !(countBudget != null && countBudget > 0)) {
    throw new CampaignError("Say how many free bookings this campaign may give out");
  }
  if (countBudget != null && !(countBudget > 0)) {
    throw new CampaignError("The number of gifts has to be more than zero");
  }

  // §42's promo code: the trigger and the code come together, and the code
  // has to be unique across every network — the driver types it without
  // saying whose it is.
  const code = input.promoCode !== undefined ? input.promoCode : current?.promoCode;
  if (trigger === "PROMO_CODE") {
    const normalized = code ? normalizePromoCode(code) : "";
    if (normalized.length < 3) {
      throw new CampaignError("A promo-code campaign needs a code of at least 3 characters");
    }
    if (!/^[A-Z0-9-]+$/.test(normalized)) {
      throw new CampaignError("A code may hold letters, digits and a dash");
    }
    const taken = await prisma.campaign.findUnique({
      where: { promoCode: normalized },
      select: { id: true },
    });
    if (taken && taken.id !== current?.id) {
      throw new CampaignError("That code is already in use");
    }
  } else if (code) {
    throw new CampaignError("Only a promo-code campaign carries a code");
  }
  if (input.validityDays !== undefined && !(input.validityDays >= 1)) {
    throw new CampaignError("A gift has to be valid for at least a day");
  }

  if (trigger === "NTH_CHARGE" && !(input.triggerN != null && input.triggerN >= 1)) {
    throw new CampaignError("Say which charge in a row earns the gift (N)");
  }
  if (trigger === "VOLUME_PERIOD") {
    if (!(input.triggerN != null && input.triggerN > 0)) {
      throw new CampaignError("Say how many kWh earn the gift");
    }
    if (!(input.triggerPeriodDays != null && input.triggerPeriodDays >= 1)) {
      throw new CampaignError("Say over what period those kWh count");
    }
  }

  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
    throw new CampaignError("The campaign ends before it starts");
  }

  if (input.scopePointIds && input.scopePointIds.length > 0) {
    const mine = await prisma.acceptancePoint.count({
      where: { operatorId, id: { in: input.scopePointIds } },
    });
    if (mine !== new Set(input.scopePointIds).size) {
      throw new CampaignError("One of those points is not in this network");
    }
  }

  if (input.zoneId !== undefined) {
    const zone = await prisma.gridZone.findUnique({ where: { id: input.zoneId } });
    if (!zone) throw new CampaignError("No such zone");
  }
}

/**
 * A new campaign starts as a draft: the moment one is active it begins paying
 * out of the partner's own generation, and that should be a decision, not a
 * side effect of filling in a form.
 */
export async function createCampaign(
  operatorId: string,
  userId: string,
  input: CampaignInput,
) {
  await requireNetwork(operatorId, userId);
  if (!input.name?.trim()) throw new CampaignError("The campaign needs a name");
  await validate(operatorId, input);

  return prisma.campaign.create({
    data: {
      operatorId,
      zoneId: input.zoneId,
      name: input.name.trim(),
      trigger: input.trigger,
      triggerN: input.triggerN ?? null,
      triggerPeriodDays: input.triggerPeriodDays ?? null,
      giftKwh: input.giftKwh,
      cashbackPct: input.cashbackPct ?? null,
      scopePointIds: input.scopePointIds ?? [],
      validityDays: input.validityDays,
      // Cashback repeats with every payment; a gift is once per client
      // unless the partner says otherwise.
      // A code is redeemed once by one driver, whatever the form says: §42's
      // "один раз на клиента" is the only thing that stops one person from
      // emptying the campaign.
      oncePerClient:
        input.trigger === "PROMO_CODE"
          ? true
          : (input.oncePerClient ?? input.trigger !== "TOKEN_PAYMENT"),
      minNextChargeKwh: input.minNextChargeKwh ?? null,
      exclusive: input.exclusive ?? false,
      discountPct: input.discountPct ?? null,
      freeBooking: input.freeBooking ?? false,
      promoCode: input.promoCode ? normalizePromoCode(input.promoCode) : null,
      budgetKwh: input.budgetKwh,
      budgetGrants: input.budgetGrants ?? null,
      fundingSource: input.fundingSource ?? "TOKENS",
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
    },
  });
}

export async function updateCampaign(
  campaignId: string,
  userId: string,
  input: Partial<CampaignInput>,
) {
  const campaign = await requireOwnedCampaign(campaignId, userId);
  await validate(campaign.operatorId, input, campaign);

  // Topping a budget up is fine; cutting it below what is already promised is
  // not — those grants are already in drivers' hands.
  if (input.budgetKwh !== undefined && roundKwh(input.budgetKwh) < roundKwh(num(campaign.issuedKwh))) {
    throw new CampaignError("That budget is less than what has already been given away");
  }

  const data: Prisma.CampaignUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.trigger !== undefined) data.trigger = input.trigger;
  if (input.triggerN !== undefined) data.triggerN = input.triggerN;
  if (input.triggerPeriodDays !== undefined) data.triggerPeriodDays = input.triggerPeriodDays;
  if (input.giftKwh !== undefined) data.giftKwh = input.giftKwh;
  if (input.cashbackPct !== undefined) data.cashbackPct = input.cashbackPct;
  if (input.scopePointIds !== undefined) data.scopePointIds = input.scopePointIds;
  if (input.validityDays !== undefined) data.validityDays = input.validityDays;
  if (input.oncePerClient !== undefined) data.oncePerClient = input.oncePerClient;
  if (input.minNextChargeKwh !== undefined) data.minNextChargeKwh = input.minNextChargeKwh;
  if (input.exclusive !== undefined) data.exclusive = input.exclusive;
  if (input.discountPct !== undefined) data.discountPct = input.discountPct;
  if (input.freeBooking !== undefined) data.freeBooking = input.freeBooking;
  if (input.promoCode !== undefined) {
    data.promoCode = input.promoCode ? normalizePromoCode(input.promoCode) : null;
  }
  if (input.budgetKwh !== undefined) data.budgetKwh = input.budgetKwh;
  if (input.budgetGrants !== undefined) data.budgetGrants = input.budgetGrants;
  if (input.fundingSource !== undefined) data.fundingSource = input.fundingSource;
  if (input.startsAt !== undefined) data.startsAt = input.startsAt;
  if (input.endsAt !== undefined) data.endsAt = input.endsAt;

  return prisma.campaign.update({ where: { id: campaignId }, data });
}

const PARTNER_STATUSES: CampaignStatus[] = ["DRAFT", "ACTIVE", "PAUSED", "ENDED"];

/** Start, pause or end. `EXHAUSTED` is the system's word, not the partner's. */
export async function setCampaignStatus(
  campaignId: string,
  userId: string,
  status: CampaignStatus,
) {
  const campaign = await requireOwnedCampaign(campaignId, userId);
  if (!PARTNER_STATUSES.includes(status)) {
    throw new CampaignError("A campaign cannot be put into that state by hand");
  }

  if (status === "ACTIVE") {
    const left = roundKwh(num(campaign.budgetKwh) - num(campaign.issuedKwh));
    // A cashback campaign has no fixed gift to measure the remainder
    // against; any budget at all is enough to pay somebody back.
    const needed =
      campaign.trigger === "TOKEN_PAYMENT" ? 0.001 : roundKwh(num(campaign.giftKwh));
    if (left < needed) {
      throw new CampaignError("The budget is spent; raise it before running the campaign again");
    }
    // §42 — the same question for the campaign measured in gifts rather than
    // in kWh (a free booking).
    if (campaign.budgetGrants != null && campaign.issuedGrants >= campaign.budgetGrants) {
      throw new CampaignError(
        "Every gift of this campaign has been given out; raise the number first",
      );
    }
  }

  return prisma.campaign.update({
    where: { id: campaignId },
    // A reason for a pause the system wrote means nothing once the partner
    // starts it again.
    data: { status, ...(status === "ACTIVE" ? { pauseReason: null } : {}) },
  });
}

export interface CampaignRow {
  id: string;
  name: string;
  trigger: CampaignTrigger;
  triggerN: number | null;
  triggerPeriodDays: number | null;
  status: CampaignStatus;
  pauseReason: string | null;
  giftKwh: number;
  /** US-12 — null for a gift campaign. */
  cashbackPct: number | null;
  budgetKwh: number;
  /** Budget consumed by live grants (§42). */
  issuedKwh: number;
  scopePointIds: string[];
  validityDays: number;
  oncePerClient: boolean;
  minNextChargeKwh: number | null;
  /** §42's three additions: no stacking, a discount, a free booking. */
  exclusive: boolean;
  discountPct: number | null;
  freeBooking: boolean;
  promoCode: string | null;
  budgetGrants: number | null;
  issuedGrants: number;
  startsAt: Date | null;
  endsAt: Date | null;
  zoneId: string;
  fundingSource: "TOKENS" | "FIAT";
  /** §44 in its simplest form: handed out, actually used, burned unused. */
  grantCount: number;
  issuedToClientsKwh: number;
  usedKwh: number;
  expiredKwh: number;
}

/** The list the partner reads, with what each campaign has cost them so far. */
export async function readCampaigns(
  operatorId: string,
  userId: string,
): Promise<CampaignRow[]> {
  await requireNetwork(operatorId, userId);

  const campaigns = await prisma.campaign.findMany({
    where: { operatorId },
    orderBy: { createdAt: "desc" },
    include: {
      grants: {
        select: { amountKwh: true, usedKwh: true, status: true },
      },
    },
  });

  return campaigns.map((c) => {
    let issuedToClientsKwh = 0;
    let usedKwh = 0;
    let expiredKwh = 0;
    for (const g of c.grants) {
      const amount = num(g.amountKwh);
      const used = num(g.usedKwh);
      issuedToClientsKwh += amount;
      usedKwh += used;
      // §43 — what burned is what nobody spent before the date.
      if (g.status === "EXPIRED") expiredKwh += Math.max(0, amount - used);
    }

    return {
      id: c.id,
      name: c.name,
      trigger: c.trigger,
      triggerN: c.triggerN,
      triggerPeriodDays: c.triggerPeriodDays,
      status: c.status,
      pauseReason: c.pauseReason,
      giftKwh: num(c.giftKwh),
      cashbackPct: numOrNull(c.cashbackPct),
      minNextChargeKwh: numOrNull(c.minNextChargeKwh),
      exclusive: c.exclusive,
      discountPct: numOrNull(c.discountPct),
      freeBooking: c.freeBooking,
      promoCode: c.promoCode,
      budgetGrants: c.budgetGrants,
      issuedGrants: c.issuedGrants,
      budgetKwh: num(c.budgetKwh),
      issuedKwh: num(c.issuedKwh),
      scopePointIds: c.scopePointIds,
      validityDays: c.validityDays,
      oncePerClient: c.oncePerClient,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      zoneId: c.zoneId,
      fundingSource: c.fundingSource,
      grantCount: c.grants.length,
      issuedToClientsKwh: roundKwh(issuedToClientsKwh),
      usedKwh: roundKwh(usedKwh),
      expiredKwh: roundKwh(expiredKwh),
    };
  });
}
