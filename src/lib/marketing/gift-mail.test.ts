// US-41 — "push клиенту". Push is behind `pushOpen()` (APNs and FCM keys are
// the owner's to obtain), so what actually reaches the driver today is a
// letter; `notifiedAt` is what makes "within a minute" checkable either way.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyPendingGrants, tellClientAboutGift } from "./gift-mail";

const PREFIX = "test_gmail_";
const ZONE_CODE = "TESTGMAIL";

let zoneId: string;
let operatorId: string;
let campaignId: string;
let driverUserId: string;
let silentUserId: string;

const sent: { to: string; subject: string; html: string }[] = [];
const spy = async (to: string, subject: string, html: string) => {
  sent.push({ to, subject, html });
};

async function wipe() {
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

async function grant(userId: string, over: Partial<Prisma.PromoGrantUncheckedCreateInput> = {}) {
  return prisma.promoGrant.create({
    data: {
      campaignId,
      userId,
      operatorId,
      amountKwh: new Prisma.Decimal(5),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      ...over,
    },
  });
}

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Gift mail zone", currency: "EUR" },
    })
  ).id;

  driverUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}driver` },
      update: { email: `${PREFIX}driver@example.test`, emailVerified: new Date() },
      create: {
        username: `${PREFIX}driver`,
        passwordHash: "x",
        email: `${PREFIX}driver@example.test`,
        emailVerified: new Date(),
        preferredLocale: "ru",
      },
    })
  ).id;
  // Somebody who never confirmed an address: nothing to send to, and that is
  // not a reason to try forever.
  silentUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}silent` },
      update: {},
      create: { username: `${PREFIX}silent`, passwordHash: "x" },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Gift mail network" },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: {
        operatorId,
        zoneId,
        name: "Welcome",
        trigger: "FIRST_CHARGE",
        giftKwh: new Prisma.Decimal(5),
        validityDays: 30,
        budgetKwh: new Prisma.Decimal(100),
        status: "ACTIVE",
      },
    })
  ).id;
});

beforeEach(async () => {
  sent.length = 0;
  await prisma.promoGrant.deleteMany({ where: { operatorId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("tellClientAboutGift", () => {
  it("writes to the driver, names the network, the kWh and the date", async () => {
    const g = await grant(driverUserId);

    const channels = await tellClientAboutGift(g.id, { sendTo: spy });

    expect(channels).toContain("email");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(`${PREFIX}driver@example.test`);
    expect(sent[0].html).toContain("Gift mail network");
    expect(sent[0].html).toContain("5");

    const after = await prisma.promoGrant.findUniqueOrThrow({ where: { id: g.id } });
    expect(after.notifiedAt).not.toBeNull();
  });

  it("does not write twice", async () => {
    const g = await grant(driverUserId);
    await tellClientAboutGift(g.id, { sendTo: spy });
    await tellClientAboutGift(g.id, { sendTo: spy });
    expect(sent).toHaveLength(1);
  });

  it("stops owing a letter to somebody with no confirmed address", async () => {
    const g = await grant(silentUserId);

    expect(await tellClientAboutGift(g.id, { sendTo: spy })).toEqual([]);
    expect(sent).toHaveLength(0);
    // Marked done regardless: there is nothing to retry.
    const after = await prisma.promoGrant.findUniqueOrThrow({ where: { id: g.id } });
    expect(after.notifiedAt).not.toBeNull();
  });

  it("leaves the grant owing when the mail server refuses", async () => {
    const g = await grant(driverUserId);
    const broken = async () => {
      throw new Error("smtp down");
    };

    expect(await tellClientAboutGift(g.id, { sendTo: broken })).toEqual([]);
    const after = await prisma.promoGrant.findUniqueOrThrow({ where: { id: g.id } });
    expect(after.notifiedAt).toBeNull();
  });

  it("adds push once the keys exist", async () => {
    const g = await grant(driverUserId);
    const channels = await tellClientAboutGift(g.id, { sendTo: spy, pushIsOpen: true });
    expect(channels).toEqual(["email", "push"]);
  });
});

describe("notifyPendingGrants — the sweep behind 'within a minute'", () => {
  it("takes the grants nobody has been told about and leaves the rest", async () => {
    const owing = await grant(driverUserId);
    const told = await grant(silentUserId, { notifiedAt: new Date() });

    const count = await notifyPendingGrants({ sendTo: spy });

    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    const after = await prisma.promoGrant.findUniqueOrThrow({ where: { id: owing.id } });
    expect(after.notifiedAt).not.toBeNull();
    const untouched = await prisma.promoGrant.findUniqueOrThrow({ where: { id: told.id } });
    expect(untouched.notifiedAt).toEqual(told.notifiedAt);
  });

  it("does not chase a grant that has already expired", async () => {
    await grant(driverUserId, {
      status: "EXPIRED",
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    expect(await notifyPendingGrants({ sendTo: spy })).toBe(0);
  });
});
