// §53 — which rates a given partner actually pays. Four things can decide it,
// and the order matters: the default plan, a plan for their participant type,
// the plan they were put on, and the individual terms written over it.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { quoteCharge } from "@/lib/exchange/payment-service";
import { FeeePlanError, assignPartnerPlan, resolveFeeRates, savePlan } from "./fee-plan-service";

const PREFIX = "test_feeplan_";

let producerCompanyId: string;
let buyerCompanyId: string;
let operatorId: string;

async function wipe() {
  await prisma.partnerPlan.deleteMany({
    where: {
      OR: [
        { company: { regNumber: { startsWith: PREFIX } } },
        { operator: { slug: { startsWith: PREFIX } } },
      ],
    },
  });
  await prisma.platformFeePlan.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.company.deleteMany({ where: { regNumber: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();

  producerCompanyId = (
    await prisma.company.create({
      data: {
        legalName: "Fee plan producer",
        country: "SK",
        regNumber: `${PREFIX}prod`,
        type: "PRODUCER",
        kybStatus: "APPROVED",
      },
    })
  ).id;
  buyerCompanyId = (
    await prisma.company.create({
      data: {
        legalName: "Fee plan buyer",
        country: "SK",
        regNumber: `${PREFIX}buyer`,
        type: "WHOLESALE",
        kybStatus: "APPROVED",
      },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Fee plan network" },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.partnerPlan.deleteMany({
    where: { OR: [{ companyId: producerCompanyId }, { companyId: buyerCompanyId }, { operatorId }] },
  });
  await prisma.platformFeePlan.deleteMany({ where: { name: { startsWith: PREFIX } } });
});

afterAll(async () => {
  await wipe();
});

const basic = () =>
  savePlan({
    name: `${PREFIX}basic`,
    tier: "BASIC",
    tradeFeePct: 1,
    chargeFeePct: 2,
    bookingFeePct: 0,
    isDefault: true,
  });

describe("savePlan", () => {
  it("creates a plan and finds it again by name", async () => {
    const plan = await basic();
    expect(plan.tier).toBe("BASIC");
    expect(Number(plan.tradeFeePct)).toBe(1);
  });

  it("refuses a rate outside nought to a hundred", async () => {
    await expect(savePlan({ name: `${PREFIX}bad`, tradeFeePct: -1 })).rejects.toThrow(FeeePlanError);
    await expect(savePlan({ name: `${PREFIX}bad`, chargeFeePct: 140 })).rejects.toThrow(
      FeeePlanError,
    );
  });

  it("refuses a subscription period nobody bills on", async () => {
    await expect(
      savePlan({ name: `${PREFIX}bad`, subscriptionPeriod: "fortnight" }),
    ).rejects.toThrow(/period/i);
  });

  it("leaves exactly one default plan standing", async () => {
    await basic();
    const second = await savePlan({
      name: `${PREFIX}second`,
      tier: "EXTENDED",
      isDefault: true,
    });

    const defaults = await prisma.platformFeePlan.findMany({
      where: { isDefault: true, name: { startsWith: PREFIX } },
    });
    expect(defaults.map((d) => d.id)).toEqual([second.id]);
  });

  it("updates a plan in place rather than making a second one", async () => {
    const plan = await basic();
    const again = await savePlan({ name: `${PREFIX}basic`, tradeFeePct: 1.5 });

    expect(again.id).toBe(plan.id);
    expect(Number(again.tradeFeePct)).toBe(1.5);
    expect(Number(again.chargeFeePct)).toBe(2);
  });
});

describe("resolveFeeRates — §53's order of precedence", () => {
  it("falls back to the code's own rates when there is no plan at all", async () => {
    const rates = await resolveFeeRates({ companyId: producerCompanyId });
    expect(rates.tradeFeePct).toBe(1);
    expect(rates.chargeFeePct).toBe(2);
    expect(rates.source).toBe("builtin");
  });

  it("uses the default plan when the partner is on none", async () => {
    await basic();
    const rates = await resolveFeeRates({ companyId: producerCompanyId });
    expect(rates.source).toBe("default");
    expect(rates.planName).toBe(`${PREFIX}basic`);
  });

  it("prefers a plan written for that participant type", async () => {
    await basic();
    await savePlan({
      name: `${PREFIX}producers`,
      participantType: "PRODUCER",
      tradeFeePct: 0.5,
      chargeFeePct: 1,
    });

    const producer = await resolveFeeRates({ companyId: producerCompanyId });
    expect(producer.tradeFeePct).toBe(0.5);
    expect(producer.source).toBe("participant-type");

    // A wholesale buyer has no plan of its own and stays on the default.
    const buyer = await resolveFeeRates({ companyId: buyerCompanyId });
    expect(buyer.tradeFeePct).toBe(1);
    expect(buyer.source).toBe("default");
  });

  it("prefers the plan the partner was actually put on", async () => {
    await basic();
    await savePlan({ name: `${PREFIX}producers`, participantType: "PRODUCER", tradeFeePct: 0.5 });
    const corporate = await savePlan({
      name: `${PREFIX}corp`,
      tier: "CORPORATE",
      tradeFeePct: 0.25,
      chargeFeePct: 0.5,
      subscriptionFiat: 199,
    });
    await assignPartnerPlan({ companyId: producerCompanyId, planId: corporate.id });

    const rates = await resolveFeeRates({ companyId: producerCompanyId });
    expect(rates.tradeFeePct).toBe(0.25);
    expect(rates.chargeFeePct).toBe(0.5);
    expect(rates.subscriptionFiat).toBe(199);
    expect(rates.source).toBe("assigned");
  });

  it("lets individual terms override only the fields they name", async () => {
    const plan = await basic();
    await assignPartnerPlan({
      companyId: producerCompanyId,
      planId: plan.id,
      overrides: { tradeFeePct: 0 },
      note: "First year free on trades",
    });

    const rates = await resolveFeeRates({ companyId: producerCompanyId });
    expect(rates.tradeFeePct).toBe(0);
    // Untouched by the override.
    expect(rates.chargeFeePct).toBe(2);
    expect(rates.source).toBe("override");
  });

  it("ignores an override that is not a rate", async () => {
    const plan = await basic();
    await assignPartnerPlan({
      companyId: producerCompanyId,
      planId: plan.id,
      overrides: { tradeFeePct: "free", nonsense: 5, chargeFeePct: 1.25 },
    });

    const rates = await resolveFeeRates({ companyId: producerCompanyId });
    expect(rates.tradeFeePct).toBe(1);
    expect(rates.chargeFeePct).toBe(1.25);
  });

  it("refuses an override outside nought to a hundred", async () => {
    const plan = await basic();
    await expect(
      assignPartnerPlan({
        companyId: producerCompanyId,
        planId: plan.id,
        overrides: { chargeFeePct: 250 },
      }),
    ).rejects.toThrow(FeeePlanError);
  });

  it("resolves a charging network by its own id, not a company", async () => {
    const plan = await savePlan({
      name: `${PREFIX}networks`,
      tier: "EXTENDED",
      chargeFeePct: 3,
      bookingFeePct: 1.5,
    });
    await assignPartnerPlan({ operatorId, planId: plan.id });

    const rates = await resolveFeeRates({ operatorId });
    expect(rates.chargeFeePct).toBe(3);
    expect(rates.bookingFeePct).toBe(1.5);
  });

  it("refuses to resolve rates for nobody", async () => {
    await expect(resolveFeeRates({})).rejects.toThrow(FeeePlanError);
  });

  it("refuses to put a partner on a plan that does not exist", async () => {
    await expect(
      assignPartnerPlan({ companyId: producerCompanyId, planId: "no-such-plan" }),
    ).rejects.toThrow(FeeePlanError);
  });

  it("moves a partner from one plan to another rather than listing them twice", async () => {
    const first = await basic();
    const second = await savePlan({ name: `${PREFIX}second`, tier: "EXTENDED", chargeFeePct: 4 });
    await assignPartnerPlan({ companyId: producerCompanyId, planId: first.id });
    await assignPartnerPlan({ companyId: producerCompanyId, planId: second.id });

    expect(
      await prisma.partnerPlan.count({ where: { companyId: producerCompanyId } }),
    ).toBe(1);
    expect((await resolveFeeRates({ companyId: producerCompanyId })).chargeFeePct).toBe(4);
  });

  it("does not offer a plan that was switched off", async () => {
    await basic();
    const retired = await savePlan({
      name: `${PREFIX}retired`,
      participantType: "PRODUCER",
      tradeFeePct: 0.1,
      active: false,
    });
    expect(retired.active).toBe(false);

    const rates = await resolveFeeRates({ companyId: producerCompanyId });
    expect(rates.tradeFeePct).toBe(1);
    expect(rates.source).toBe("default");
  });
});

describe("§53 card tariffs", () => {
  it("refuses an interchange rate while there is no card contract", async () => {
    await expect(
      savePlan({ name: `${PREFIX}cards`, cardIssueFiat: 5 }),
    ).rejects.toThrow(/card/i);
  });
});

describe("the older Company.feePlan still decides, where it was set", () => {
  it("is preferred over a type-wide or default plan", async () => {
    await basic();
    await savePlan({ name: `${PREFIX}producers`, participantType: "PRODUCER", tradeFeePct: 0.5 });

    const legacy = await prisma.feePlan.create({
      data: {
        name: `${PREFIX}legacy`,
        tradeFeePct: new Prisma.Decimal(0.7),
        chargeFeePct: new Prisma.Decimal(1.4),
      },
    });
    await prisma.company.update({
      where: { id: producerCompanyId },
      data: { feePlanId: legacy.id },
    });

    const rates = await resolveFeeRates({ companyId: producerCompanyId });
    expect(rates.tradeFeePct).toBe(0.7);
    expect(rates.chargeFeePct).toBe(1.4);
    expect(rates.source).toBe("company-fee-plan");

    await prisma.company.update({ where: { id: producerCompanyId }, data: { feePlanId: null } });
    await prisma.feePlan.delete({ where: { id: legacy.id } });
  });

  it("gives way to a plan the partner was explicitly put on", async () => {
    const corporate = await savePlan({
      name: `${PREFIX}corp`,
      tier: "CORPORATE",
      tradeFeePct: 0.25,
      chargeFeePct: 0.5,
    });
    const legacy = await prisma.feePlan.create({
      data: {
        name: `${PREFIX}legacy2`,
        tradeFeePct: new Prisma.Decimal(0.7),
        chargeFeePct: new Prisma.Decimal(1.4),
      },
    });
    await prisma.company.update({
      where: { id: producerCompanyId },
      data: { feePlanId: legacy.id },
    });
    await assignPartnerPlan({ companyId: producerCompanyId, planId: corporate.id });

    const rates = await resolveFeeRates({ companyId: producerCompanyId });
    expect(rates.tradeFeePct).toBe(0.25);
    expect(rates.source).toBe("assigned");

    await prisma.company.update({ where: { id: producerCompanyId }, data: { feePlanId: null } });
    await prisma.feePlan.delete({ where: { id: legacy.id } });
  });
});

// ---------------------------------------------------------------------------
// §53 on the charging path. In the same file as the rates above on purpose:
// "the default plan" is one row for the whole platform, so two test files
// racing over `PlatformFeePlan` saw each other's defaults. One file cannot
// race with itself.
// ---------------------------------------------------------------------------

const CHG_PREFIX = "test_chgfee_";
const CHG_ZONE = "TESTCHGFEE";

let chgZoneId: string;
let chgOperatorId: string;
let chgDriverUserId: string;
let chgPointId: string;
let chgAssetId: string;

async function chgWipe() {
  await prisma.partnerPlan.deleteMany({ where: { operator: { slug: { startsWith: CHG_PREFIX } } } });
  await prisma.platformFeePlan.deleteMany({ where: { name: { startsWith: CHG_PREFIX } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: CHG_ZONE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: CHG_ZONE } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: CHG_PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: CHG_PREFIX } } });
  await prisma.order.deleteMany({ where: { zone: { code: CHG_ZONE } } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${CHG_PREFIX}reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: `${CHG_PREFIX}reg` } });
  await prisma.gridZone.deleteMany({ where: { code: CHG_ZONE } });
}

/** A resting ask, so the session has to buy and therefore pays commission. */
async function chgRestingAsk(amountKwh: number, price: number) {
  const seller = await prisma.user.upsert({
    where: { username: `${CHG_PREFIX}seller` },
    update: {},
    create: { username: `${CHG_PREFIX}seller`, passwordHash: "x" },
  });
  const wallet = await prisma.wallet.upsert({
    where: { ownerUserId_zoneId: { ownerUserId: seller.id, zoneId: chgZoneId } },
    update: {},
    create: { ownerUserId: seller.id, zoneId: chgZoneId },
  });
  await prisma.energyToken.create({
    data: {
      zoneId: chgZoneId,
      assetId: chgAssetId,
      ownerWalletId: wallet.id,
      amountKwh: new Prisma.Decimal(amountKwh),
      intervalStart: new Date(),
      status: "AVAILABLE",
    },
  });
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { kwhBalance: { increment: new Prisma.Decimal(amountKwh) } },
  });
  await prisma.order.create({
    data: {
      walletId: wallet.id,
      zoneId: chgZoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: new Prisma.Decimal(amountKwh),
      limitPrice: new Prisma.Decimal(price),
      status: "NEW",
    },
  });
}

beforeAll(async () => {
  await chgWipe();

  chgZoneId = (
    await prisma.gridZone.create({
      data: { code: CHG_ZONE, country: "SK", name: "Charge fee zone", currency: "EUR" },
    })
  ).id;

  chgDriverUserId = (
    await prisma.user.upsert({
      where: { username: `${CHG_PREFIX}driver` },
      update: {},
      create: { username: `${CHG_PREFIX}driver`, passwordHash: "x" },
    })
  ).id;

  chgOperatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${CHG_PREFIX}net`, displayName: "Charge fee network" },
    })
  ).id;
  chgPointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId: chgOperatorId, type: "CHARGING_STATION", name: "A", gridZoneId: chgZoneId },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: "Charge fee producer",
      country: "SK",
      regNumber: `${CHG_PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  chgAssetId = (
    await prisma.asset.create({
      data: {
        companyId: company.id,
        gridZoneId: chgZoneId,
        kind: "SOLAR",
        name: "Charge fee roof",
        capacityKw: new Prisma.Decimal(10),
        status: "ACTIVE",
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.partnerPlan.deleteMany({ where: { operatorId: chgOperatorId } });
  await prisma.platformFeePlan.deleteMany({ where: { name: { startsWith: CHG_PREFIX } } });
  await prisma.order.deleteMany({ where: { zoneId: chgZoneId } });
  await prisma.energyToken.deleteMany({ where: { zoneId: chgZoneId } });
  await prisma.wallet.deleteMany({ where: { zoneId: chgZoneId } });
  await chgRestingAsk(20, 0.2);
});

afterAll(async () => {
  await chgWipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: CHG_PREFIX } } });
});

describe("the commission on a charging session comes from the network's plan", () => {
  it("charges the built-in rate when no plan is configured", async () => {
    const quote = await quoteCharge({
      userId: chgDriverUserId,
      zoneId: chgZoneId,
      requestedKwh: 10,
      pointId: chgPointId,
    });

    // 10 kWh at 0.20 = 2.00, and the built-in commission is 2 %.
    expect(quote.energyCost).toBe(2);
    expect(quote.fee).toBe(0.04);
  });

  it("charges the plan's rate once the network is on one", async () => {
    const plan = await savePlan({ name: `${CHG_PREFIX}corp`, tier: "CORPORATE", chargeFeePct: 0.5 });
    await assignPartnerPlan({ operatorId: chgOperatorId, planId: plan.id });

    const quote = await quoteCharge({
      userId: chgDriverUserId,
      zoneId: chgZoneId,
      requestedKwh: 10,
      pointId: chgPointId,
    });

    expect(quote.energyCost).toBe(2);
    expect(quote.fee).toBe(0.01);
  });

  it("charges the individual terms written over the plan", async () => {
    const plan = await savePlan({ name: `${CHG_PREFIX}corp`, tier: "CORPORATE", chargeFeePct: 0.5 });
    await assignPartnerPlan({
      operatorId: chgOperatorId,
      planId: plan.id,
      overrides: { chargeFeePct: 0 },
      note: "No commission for the pilot",
    });

    const quote = await quoteCharge({
      userId: chgDriverUserId,
      zoneId: chgZoneId,
      requestedKwh: 10,
      pointId: chgPointId,
    });

    expect(quote.fee).toBe(0);
    expect(quote.total).toBe(2);
  });

  it("falls back to the built-in rate for a session at nobody's point", async () => {
    const plan = await savePlan({ name: `${CHG_PREFIX}corp`, chargeFeePct: 0.5 });
    await assignPartnerPlan({ operatorId: chgOperatorId, planId: plan.id });

    const quote = await quoteCharge({ userId: chgDriverUserId, zoneId: chgZoneId, requestedKwh: 10 });
    expect(quote.fee).toBe(0.04);
  });

  it("shows the commission before the driver confirms (§54)", async () => {
    const quote = await quoteCharge({
      userId: chgDriverUserId,
      zoneId: chgZoneId,
      requestedKwh: 10,
      pointId: chgPointId,
    });

    // §54 "Клиент видит итоговую цену и все платы до подтверждения": the
    // quote carries the energy, the fee and the total separately.
    expect(quote.total).toBe(quote.energyCost + quote.fee);
    expect(quote.authorizedFiat).toBeGreaterThanOrEqual(quote.total);
  });
});
