// §53 — "Комиссия платформы со сделки, зарядки, брони, по типу партнёра и
// тарифному плану." The plans existed before this and nothing read them on a
// charging session: every session paid the built-in 2 %.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { quoteCharge } from "@/lib/exchange/payment-service";
import { assignPartnerPlan, savePlan } from "./fee-plan-service";

const PREFIX = "test_chgfee_";
const ZONE_CODE = "TESTCHGFEE";

let zoneId: string;
let operatorId: string;
let driverUserId: string;
let pointId: string;
let assetId: string;

async function wipe() {
  await prisma.partnerPlan.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.platformFeePlan.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.order.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${PREFIX}reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: `${PREFIX}reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

/** A resting ask, so the session has to buy and therefore pays commission. */
async function restingAsk(amountKwh: number, price: number) {
  const seller = await prisma.user.upsert({
    where: { username: `${PREFIX}seller` },
    update: {},
    create: { username: `${PREFIX}seller`, passwordHash: "x" },
  });
  const wallet = await prisma.wallet.upsert({
    where: { ownerUserId_zoneId: { ownerUserId: seller.id, zoneId } },
    update: {},
    create: { ownerUserId: seller.id, zoneId },
  });
  await prisma.energyToken.create({
    data: {
      zoneId,
      assetId,
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
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: new Prisma.Decimal(amountKwh),
      limitPrice: new Prisma.Decimal(price),
      status: "NEW",
    },
  });
}

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Charge fee zone", currency: "EUR" },
    })
  ).id;

  driverUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}driver` },
      update: {},
      create: { username: `${PREFIX}driver`, passwordHash: "x" },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Charge fee network" },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "A", gridZoneId: zoneId },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: "Charge fee producer",
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  assetId = (
    await prisma.asset.create({
      data: {
        companyId: company.id,
        gridZoneId: zoneId,
        kind: "SOLAR",
        name: "Charge fee roof",
        capacityKw: new Prisma.Decimal(10),
        status: "ACTIVE",
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.partnerPlan.deleteMany({ where: { operatorId } });
  await prisma.platformFeePlan.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.order.deleteMany({ where: { zoneId } });
  await prisma.energyToken.deleteMany({ where: { zoneId } });
  await prisma.wallet.deleteMany({ where: { zoneId } });
  await restingAsk(20, 0.2);
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("the commission on a charging session comes from the network's plan", () => {
  it("charges the built-in rate when no plan is configured", async () => {
    const quote = await quoteCharge({
      userId: driverUserId,
      zoneId,
      requestedKwh: 10,
      pointId,
    });

    // 10 kWh at 0.20 = 2.00, and the built-in commission is 2 %.
    expect(quote.energyCost).toBe(2);
    expect(quote.fee).toBe(0.04);
  });

  it("charges the plan's rate once the network is on one", async () => {
    const plan = await savePlan({ name: `${PREFIX}corp`, tier: "CORPORATE", chargeFeePct: 0.5 });
    await assignPartnerPlan({ operatorId, planId: plan.id });

    const quote = await quoteCharge({
      userId: driverUserId,
      zoneId,
      requestedKwh: 10,
      pointId,
    });

    expect(quote.energyCost).toBe(2);
    expect(quote.fee).toBe(0.01);
  });

  it("charges the individual terms written over the plan", async () => {
    const plan = await savePlan({ name: `${PREFIX}corp`, tier: "CORPORATE", chargeFeePct: 0.5 });
    await assignPartnerPlan({
      operatorId,
      planId: plan.id,
      overrides: { chargeFeePct: 0 },
      note: "No commission for the pilot",
    });

    const quote = await quoteCharge({
      userId: driverUserId,
      zoneId,
      requestedKwh: 10,
      pointId,
    });

    expect(quote.fee).toBe(0);
    expect(quote.total).toBe(2);
  });

  it("falls back to the built-in rate for a session at nobody's point", async () => {
    const plan = await savePlan({ name: `${PREFIX}corp`, chargeFeePct: 0.5 });
    await assignPartnerPlan({ operatorId, planId: plan.id });

    const quote = await quoteCharge({ userId: driverUserId, zoneId, requestedKwh: 10 });
    expect(quote.fee).toBe(0.04);
  });

  it("shows the commission before the driver confirms (§54)", async () => {
    const quote = await quoteCharge({
      userId: driverUserId,
      zoneId,
      requestedKwh: 10,
      pointId,
    });

    // §54 "Клиент видит итоговую цену и все платы до подтверждения": the
    // quote carries the energy, the fee and the total separately.
    expect(quote.total).toBe(quote.energyCost + quote.fee);
    expect(quote.authorizedFiat).toBeGreaterThanOrEqual(quote.total);
  });
});
