// §42's gift constructor as the partner fills it in: what a campaign may say,
// who may say it, and what is refused rather than promised.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FeatureClosedError } from "@/lib/exchange/gates";
import {
  CampaignError,
  createCampaign,
  readCampaigns,
  setCampaignStatus,
  updateCampaign,
} from "./campaign-service";

const PREFIX = "test_cmpsvc_";
const ZONE_CODE = "TESTCMPSVC";

let zoneId: string;
let operatorId: string;
let ownerUserId: string;
let strangerUserId: string;
let pointA: string;
let foreignPoint: string;

async function wipe() {
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

const base = {
  name: "Welcome",
  trigger: "FIRST_CHARGE" as const,
  giftKwh: 5,
  validityDays: 30,
  budgetKwh: 100,
  zoneId: "",
};

beforeAll(async () => {
  await wipe();
  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Campaign service zone", currency: "EUR" },
    })
  ).id;
  base.zoneId = zoneId;

  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: {},
        create: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  ownerUserId = await user("owner");
  strangerUserId = await user("stranger");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Campaign service network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointA = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "A" },
    })
  ).id;
  const other = await prisma.chargerOperator.create({
    data: { slug: `${PREFIX}other`, displayName: "Other" },
  });
  foreignPoint = (
    await prisma.acceptancePoint.create({
      data: { operatorId: other.id, type: "CHARGING_STATION", name: "Theirs" },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.promoGrant.deleteMany({ where: { operatorId } });
  await prisma.campaign.deleteMany({ where: { operatorId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("createCampaign", () => {
  it("opens a draft, because a live campaign starts paying out at once", async () => {
    const c = await createCampaign(operatorId, ownerUserId, base);
    expect(c.status).toBe("DRAFT");
    expect(Number(c.giftKwh)).toBe(5);
    expect(c.oncePerClient).toBe(true);
  });

  it("refuses somebody else's network", async () => {
    await expect(createCampaign(operatorId, strangerUserId, base)).rejects.toThrow(CampaignError);
  });

  it("refuses a gift of nothing and a budget smaller than one gift", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, { ...base, giftKwh: 0 }),
    ).rejects.toThrow(/gift/i);
    await expect(
      createCampaign(operatorId, ownerUserId, { ...base, giftKwh: 10, budgetKwh: 5 }),
    ).rejects.toThrow(/budget/i);
  });

  it("refuses a validity of zero days", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, { ...base, validityDays: 0 }),
    ).rejects.toThrow(/day/i);
  });

  it("asks for the N of an N-th charge and the period of a volume trigger", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, { ...base, trigger: "NTH_CHARGE" }),
    ).rejects.toThrow(/which charge|N/i);
    await expect(
      createCampaign(operatorId, ownerUserId, { ...base, trigger: "VOLUME_PERIOD", triggerN: 50 }),
    ).rejects.toThrow(/period/i);
    const ok = await createCampaign(operatorId, ownerUserId, {
      ...base,
      trigger: "VOLUME_PERIOD",
      triggerN: 50,
      triggerPeriodDays: 30,
    });
    expect(ok.triggerPeriodDays).toBe(30);
  });

  it("takes a cashback campaign with a share instead of a gift (US-12)", async () => {
    const c = await createCampaign(operatorId, ownerUserId, {
      ...base,
      name: "Token cashback",
      trigger: "TOKEN_PAYMENT",
      giftKwh: 0,
      cashbackPct: 5,
      oncePerClient: false,
    });
    expect(c.trigger).toBe("TOKEN_PAYMENT");
    expect(Number(c.cashbackPct)).toBe(5);
    expect(Number(c.giftKwh)).toBe(0);
    expect(c.oncePerClient).toBe(false);
  });

  it("refuses a cashback campaign without a share, and a share that is not one", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, {
        ...base,
        trigger: "TOKEN_PAYMENT",
        giftKwh: 0,
      }),
    ).rejects.toThrow(/share|процент|cashback/i);
    await expect(
      createCampaign(operatorId, ownerUserId, {
        ...base,
        trigger: "TOKEN_PAYMENT",
        giftKwh: 0,
        cashbackPct: 101,
      }),
    ).rejects.toThrow(/share|100/i);
  });

  it("refuses a cashback campaign that gives once per client", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, {
        ...base,
        trigger: "TOKEN_PAYMENT",
        giftKwh: 0,
        cashbackPct: 5,
        oncePerClient: true,
      }),
    ).rejects.toThrow(/once|каждой/i);
  });

  it("refuses a point outside the network", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, { ...base, scopePointIds: [foreignPoint] }),
    ).rejects.toThrow(/point/i);
    const ok = await createCampaign(operatorId, ownerUserId, { ...base, scopePointIds: [pointA] });
    expect(ok.scopePointIds).toEqual([pointA]);
  });

  it("refuses money funding while the gate is shut (§42)", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, { ...base, fundingSource: "FIAT" }),
    ).rejects.toThrow(FeatureClosedError);
  });

  it("refuses a zone the network has nothing to do with", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, { ...base, zoneId: "no-such-zone" }),
    ).rejects.toThrow(CampaignError);
  });
});

describe("setCampaignStatus", () => {
  it("lets the partner start, pause and end it", async () => {
    const c = await createCampaign(operatorId, ownerUserId, base);
    expect((await setCampaignStatus(c.id, ownerUserId, "ACTIVE")).status).toBe("ACTIVE");
    expect((await setCampaignStatus(c.id, ownerUserId, "PAUSED")).status).toBe("PAUSED");
    expect((await setCampaignStatus(c.id, ownerUserId, "ENDED")).status).toBe("ENDED");
  });

  it("clears the pause reason when it runs again", async () => {
    const c = await createCampaign(operatorId, ownerUserId, base);
    await prisma.campaign.update({
      where: { id: c.id },
      data: { status: "PAUSED", pauseReason: "Not enough kWh" },
    });
    const again = await setCampaignStatus(c.id, ownerUserId, "ACTIVE");
    expect(again.pauseReason).toBeNull();
  });

  it("will not restart a campaign whose budget is spent", async () => {
    const c = await createCampaign(operatorId, ownerUserId, base);
    await prisma.campaign.update({
      where: { id: c.id },
      data: { status: "EXHAUSTED", issuedKwh: new Prisma.Decimal(100) },
    });
    await expect(setCampaignStatus(c.id, ownerUserId, "ACTIVE")).rejects.toThrow(/budget/i);
  });

  it("refuses a stranger", async () => {
    const c = await createCampaign(operatorId, ownerUserId, base);
    await expect(setCampaignStatus(c.id, strangerUserId, "ACTIVE")).rejects.toThrow(CampaignError);
  });
});

describe("updateCampaign", () => {
  it("will not cut the budget below what has already been given away", async () => {
    const c = await createCampaign(operatorId, ownerUserId, base);
    await prisma.campaign.update({
      where: { id: c.id },
      data: { issuedKwh: new Prisma.Decimal(40) },
    });
    await expect(
      updateCampaign(c.id, ownerUserId, { budgetKwh: 20 }),
    ).rejects.toThrow(/already/i);
    const ok = await updateCampaign(c.id, ownerUserId, { budgetKwh: 60 });
    expect(Number(ok.budgetKwh)).toBe(60);
  });
});

describe("readCampaigns — what the partner sees about their own money", () => {
  it("reports issued, used and expired kWh per campaign", async () => {
    const c = await createCampaign(operatorId, ownerUserId, base);
    const grant = async (
      userName: string,
      amount: number,
      used: number,
      status: "ACTIVE" | "EXPIRED" | "USED",
    ) => {
      const u = await prisma.user.upsert({
        where: { username: `${PREFIX}${userName}` },
        update: {},
        create: { username: `${PREFIX}${userName}`, passwordHash: "x" },
      });
      await prisma.promoGrant.create({
        data: {
          campaignId: c.id,
          userId: u.id,
          operatorId,
          amountKwh: new Prisma.Decimal(amount),
          usedKwh: new Prisma.Decimal(used),
          expiresAt: new Date(Date.now() + 86_400_000),
          status,
        },
      });
    };
    await grant("c1", 5, 3, "ACTIVE");
    await grant("c2", 5, 5, "USED");
    await grant("c3", 5, 1, "EXPIRED");

    const [row] = await readCampaigns(operatorId, ownerUserId);
    expect(row.grantCount).toBe(3);
    expect(row.issuedToClientsKwh).toBe(15);
    expect(row.usedKwh).toBe(9);
    expect(row.expiredKwh).toBe(4);
  });

  it("refuses a stranger", async () => {
    await expect(readCampaigns(operatorId, strangerUserId)).rejects.toThrow(CampaignError);
  });
});

describe("the rest of §42's constructor", () => {
  it("takes a discount with a ceiling in kWh", async () => {
    const c = await createCampaign(operatorId, ownerUserId, {
      ...base,
      giftKwh: 30,
      discountPct: 20,
      exclusive: true,
    });
    expect(Number(c.discountPct)).toBe(20);
    expect(c.exclusive).toBe(true);
  });

  it("refuses a discount outside 0–100 %", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, { ...base, discountPct: 120 }),
    ).rejects.toThrow("between 0 and 100");
  });

  it("refuses a discount with no ceiling to cover it", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, {
        ...base,
        giftKwh: 0,
        freeBooking: true,
        budgetGrants: 10,
        discountPct: 20,
      }),
    ).rejects.toThrow("needs a ceiling");
  });

  it("takes a free booking on its own, with a count of gifts", async () => {
    const c = await createCampaign(operatorId, ownerUserId, {
      ...base,
      giftKwh: 0,
      budgetKwh: 0,
      freeBooking: true,
      budgetGrants: 50,
    });
    expect(c.freeBooking).toBe(true);
    expect(c.budgetGrants).toBe(50);
  });

  it("refuses a free booking with no count, because nothing would stop it", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, { ...base, giftKwh: 0, freeBooking: true }),
    ).rejects.toThrow("how many free bookings");
  });

  it("takes a promo code, upper-cased, and makes it once per client", async () => {
    const c = await createCampaign(operatorId, ownerUserId, {
      ...base,
      trigger: "PROMO_CODE",
      promoCode: " welcome-10 ",
      oncePerClient: false,
    });
    expect(c.promoCode).toBe("WELCOME-10");
    expect(c.oncePerClient).toBe(true);
  });

  it("refuses a promo-code campaign with no code", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, { ...base, trigger: "PROMO_CODE" }),
    ).rejects.toThrow("needs a code");
  });

  it("refuses a code somebody else already prints", async () => {
    await createCampaign(operatorId, ownerUserId, {
      ...base,
      trigger: "PROMO_CODE",
      promoCode: "SAMECODE",
    });
    await expect(
      createCampaign(operatorId, ownerUserId, {
        ...base,
        trigger: "PROMO_CODE",
        promoCode: "samecode",
      }),
    ).rejects.toThrow("already in use");
  });

  it("refuses a code on a campaign that is not earned by one", async () => {
    await expect(
      createCampaign(operatorId, ownerUserId, { ...base, promoCode: "FIRSTCHARGE" }),
    ).rejects.toThrow("Only a promo-code campaign");
  });

  it("refuses to start a campaign whose gifts have all been given out", async () => {
    const c = await createCampaign(operatorId, ownerUserId, {
      ...base,
      giftKwh: 0,
      budgetKwh: 0,
      freeBooking: true,
      budgetGrants: 1,
    });
    await prisma.campaign.update({ where: { id: c.id }, data: { issuedGrants: 1 } });
    await expect(setCampaignStatus(c.id, ownerUserId, "ACTIVE")).rejects.toThrow(
      "given out",
    );
  });
});
