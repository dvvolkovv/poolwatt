// §53 "Что настраивает оператор Poolwatt" — the plans partners are on and the
// rates each of them actually pays.
//
// Four things can decide a rate, and §53 names them in this order:
//
//   1. the plan written over this partner individually ("индивидуальные
//      условия для отдельных партнёров"),
//   2. the plan they were put on,
//   3. a plan written for their participant type ("по типу партнёра"),
//   4. the default plan,
//
// and when none of those exists, the rates the code ships with. The last line
// matters: a platform with no plans configured still charges the §16.8
// commission, rather than charging nothing because a table is empty.

import type { CompanyType, PlanTier, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_FEE_RATES } from "@/lib/exchange/fees";
import { assertCardTariffsOpen } from "@/lib/exchange/gates";
import { num } from "@/lib/exchange/decimal";

export class FeeePlanError extends Error {}

/** §53 — what a subscription can be billed on. */
const PERIODS = ["month", "quarter", "year"];

export interface PlanInput {
  name: string;
  tier?: PlanTier;
  participantType?: CompanyType | null;
  tradeFeePct?: number;
  chargeFeePct?: number;
  bookingFeePct?: number;
  subscriptionFiat?: number;
  subscriptionPeriod?: string;
  currency?: string;
  includedInvoices?: number | null;
  includedCampaigns?: number | null;
  isDefault?: boolean;
  active?: boolean;
  /**
   * §53 "Карточные тарифы". Accepted only to refuse it loudly: the rate comes
   * from the card scheme and the EMI, and there is no contract.
   */
  cardIssueFiat?: number;
  cardInterchangePct?: number;
}

const RATE_FIELDS = ["tradeFeePct", "chargeFeePct", "bookingFeePct"] as const;
type RateField = (typeof RATE_FIELDS)[number];

function assertRate(value: number | undefined, field: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new FeeePlanError(`${field} has to be a percentage between 0 and 100, got ${value}`);
  }
}

/** Create or update one plan, by name. §53 is the operator's table to keep. */
export async function savePlan(input: PlanInput) {
  if (!input.name?.trim()) throw new FeeePlanError("A plan needs a name");
  if (input.cardIssueFiat !== undefined || input.cardInterchangePct !== undefined) {
    assertCardTariffsOpen();
  }
  for (const field of RATE_FIELDS) assertRate(input[field], field);
  if (input.subscriptionFiat !== undefined && !(input.subscriptionFiat >= 0)) {
    throw new FeeePlanError("A subscription cannot be negative");
  }
  if (input.subscriptionPeriod !== undefined && !PERIODS.includes(input.subscriptionPeriod)) {
    throw new FeeePlanError(`A subscription period is one of ${PERIODS.join(", ")}`);
  }

  const data: Prisma.PlatformFeePlanUncheckedUpdateInput = {};
  if (input.tier !== undefined) data.tier = input.tier;
  if (input.participantType !== undefined) data.participantType = input.participantType;
  if (input.tradeFeePct !== undefined) data.tradeFeePct = input.tradeFeePct;
  if (input.chargeFeePct !== undefined) data.chargeFeePct = input.chargeFeePct;
  if (input.bookingFeePct !== undefined) data.bookingFeePct = input.bookingFeePct;
  if (input.subscriptionFiat !== undefined) data.subscriptionFiat = input.subscriptionFiat;
  if (input.subscriptionPeriod !== undefined) data.subscriptionPeriod = input.subscriptionPeriod;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.includedInvoices !== undefined) data.includedInvoices = input.includedInvoices;
  if (input.includedCampaigns !== undefined) data.includedCampaigns = input.includedCampaigns;
  if (input.isDefault !== undefined) data.isDefault = input.isDefault;
  if (input.active !== undefined) data.active = input.active;

  return prisma.$transaction(async (tx) => {
    const plan = await tx.platformFeePlan.upsert({
      where: { name: input.name.trim() },
      update: data,
      // `data` never carries a name — the name is the key being upserted on.
      create: { ...(data as Prisma.PlatformFeePlanCreateInput), name: input.name.trim() },
    });

    // "The default plan" has to mean one plan, or resolving a rate becomes a
    // coin toss.
    if (input.isDefault) {
      await tx.platformFeePlan.updateMany({
        where: { isDefault: true, id: { not: plan.id } },
        data: { isDefault: false },
      });
    }

    return plan;
  });
}

export interface AssignInput {
  companyId?: string;
  operatorId?: string;
  planId: string;
  /** §53 "Индивидуальные условия" — only the fields that differ. */
  overrides?: Record<string, unknown>;
  note?: string | null;
}

export async function assignPartnerPlan(input: AssignInput) {
  if (!input.companyId && !input.operatorId) {
    throw new FeeePlanError("Name the company or the network being put on a plan");
  }
  if (input.companyId && input.operatorId) {
    throw new FeeePlanError("A plan belongs to a company or to a network, not both");
  }

  const plan = await prisma.platformFeePlan.findUnique({ where: { id: input.planId } });
  if (!plan) throw new FeeePlanError("No such plan");

  // Overrides are checked here rather than where they are read: a bad number
  // saved today would otherwise surface as a wrong invoice next month.
  for (const field of RATE_FIELDS) {
    const value = input.overrides?.[field];
    if (typeof value === "number") assertRate(value, field);
  }

  const where = input.companyId
    ? { companyId: input.companyId }
    : { operatorId: input.operatorId! };
  const data = {
    planId: plan.id,
    overrides: (input.overrides ?? {}) as Prisma.InputJsonValue,
    note: input.note?.trim() || null,
    activeFrom: new Date(),
  };

  return prisma.partnerPlan.upsert({
    where,
    update: data,
    create: { ...where, ...data },
  });
}

export type RateSource =
  | "builtin"
  | "default"
  | "participant-type"
  /** The older `Company.feePlan`, still what existing rows point at. */
  | "company-fee-plan"
  | "assigned"
  | "override";

export interface ResolvedRates {
  tradeFeePct: number;
  chargeFeePct: number;
  bookingFeePct: number;
  subscriptionFiat: number;
  subscriptionPeriod: string;
  currency: string;
  tier: PlanTier | null;
  planId: string | null;
  planName: string | null;
  source: RateSource;
}

const BUILTIN: ResolvedRates = {
  tradeFeePct: DEFAULT_FEE_RATES.tradeFeePct,
  chargeFeePct: DEFAULT_FEE_RATES.chargeFeePct,
  bookingFeePct: 0,
  subscriptionFiat: 0,
  subscriptionPeriod: "month",
  currency: "EUR",
  tier: null,
  planId: null,
  planName: null,
  source: "builtin",
};

/** What this partner pays. The order of the four sources is §53's. */
export async function resolveFeeRates(args: {
  companyId?: string;
  operatorId?: string;
}): Promise<ResolvedRates> {
  if (!args.companyId && !args.operatorId) {
    throw new FeeePlanError("Name the company or the network whose rates to resolve");
  }

  const assigned = await prisma.partnerPlan.findFirst({
    where: args.companyId ? { companyId: args.companyId } : { operatorId: args.operatorId },
    include: { plan: true },
  });

  let plan = assigned?.plan ?? null;
  let source: RateSource = assigned ? "assigned" : "builtin";

  // The older arrangement: §16.8's two percentages hung off `Company.feePlan`.
  // Those rows are real and still assigned, so they rank where they always
  // did — above a type-wide or default plan, below the new per-partner one.
  let legacy: { tradeFeePct: number; chargeFeePct: number; name: string } | null = null;
  if (!plan && args.companyId) {
    const company = await prisma.company.findUnique({
      where: { id: args.companyId },
      include: { feePlan: true },
    });
    if (company?.feePlan) {
      legacy = {
        tradeFeePct: num(company.feePlan.tradeFeePct),
        chargeFeePct: num(company.feePlan.chargeFeePct),
        name: company.feePlan.name,
      };
    }
  }

  if (!plan && !legacy) {
    // §53 "по типу партнёра" — only a company has a participant type; a
    // charging network is not one of the listing types.
    const participantType = args.companyId
      ? (
          await prisma.company.findUnique({
            where: { id: args.companyId },
            select: { type: true },
          })
        )?.type ?? null
      : null;

    if (participantType) {
      plan = await prisma.platformFeePlan.findFirst({
        where: { participantType, active: true },
        orderBy: { createdAt: "asc" },
      });
      if (plan) source = "participant-type";
    }
  }

  if (!plan && !legacy) {
    plan = await prisma.platformFeePlan.findFirst({ where: { isDefault: true, active: true } });
    if (plan) source = "default";
  }

  if (!plan) {
    if (!legacy) return BUILTIN;
    return {
      ...BUILTIN,
      tradeFeePct: legacy.tradeFeePct,
      chargeFeePct: legacy.chargeFeePct,
      planName: legacy.name,
      source: "company-fee-plan",
    };
  }

  const rates: ResolvedRates = {
    tradeFeePct: num(plan.tradeFeePct),
    chargeFeePct: num(plan.chargeFeePct),
    bookingFeePct: num(plan.bookingFeePct),
    subscriptionFiat: num(plan.subscriptionFiat),
    subscriptionPeriod: plan.subscriptionPeriod,
    currency: plan.currency,
    tier: plan.tier,
    planId: plan.id,
    planName: plan.name,
    source,
  };

  // §53 "Индивидуальные условия": a value that is not a usable rate is
  // ignored, not guessed at.
  const overrides = (assigned?.overrides ?? {}) as Record<string, unknown>;
  let overridden = false;
  for (const field of RATE_FIELDS) {
    const value = overrides[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100) {
      rates[field as RateField] = value;
      overridden = true;
    }
  }
  if (typeof overrides.subscriptionFiat === "number" && overrides.subscriptionFiat >= 0) {
    rates.subscriptionFiat = overrides.subscriptionFiat;
    overridden = true;
  }
  if (overridden) rates.source = "override";

  return rates;
}

/** The operator's page: every plan and how many partners are on it. */
export async function readPlans() {
  const plans = await prisma.platformFeePlan.findMany({
    orderBy: [{ tier: "asc" }, { name: "asc" }],
    include: { _count: { select: { partners: true } } },
  });
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    tier: p.tier,
    participantType: p.participantType,
    tradeFeePct: num(p.tradeFeePct),
    chargeFeePct: num(p.chargeFeePct),
    bookingFeePct: num(p.bookingFeePct),
    subscriptionFiat: num(p.subscriptionFiat),
    subscriptionPeriod: p.subscriptionPeriod,
    currency: p.currency,
    includedInvoices: p.includedInvoices,
    includedCampaigns: p.includedCampaigns,
    isDefault: p.isDefault,
    active: p.active,
    partnerCount: p._count.partners,
  }));
}

/** Who is on a plan, with whatever was written over it. */
export async function readPartnerPlans() {
  const rows = await prisma.partnerPlan.findMany({
    orderBy: { activeFrom: "desc" },
    include: {
      plan: { select: { name: true, tier: true } },
      company: { select: { legalName: true } },
      operator: { select: { displayName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    partner: r.company?.legalName ?? r.operator?.displayName ?? "—",
    companyId: r.companyId,
    operatorId: r.operatorId,
    planName: r.plan.name,
    tier: r.plan.tier,
    overrides: r.overrides as Record<string, unknown>,
    activeFrom: r.activeFrom,
    note: r.note,
  }));
}
