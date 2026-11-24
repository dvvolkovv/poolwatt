// US-06 — "лимитные заявки на покупку на интервал вперёд", checked the way a
// wholesale buyer meets it: pick an interval off the strip, place a limit bid
// for it, see the money held, withdraw it.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const USER = { username: "e2e_dayahead", password: "Pass1234" };
const ZONE_CODE = "E2EDAYAHEAD";
const INTERVAL_MINUTES = 60;

let userId: string;
let zoneId: string;
let walletId: string;

test.describe.configure({ mode: "serial" });

async function wipe() {
  await prisma.trade.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.order.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

/** The interval two slots ahead of the one running now — always in the future. */
function futureInterval(): Date {
  const ms = INTERVAL_MINUTES * 60 * 1000;
  return new Date(Math.floor(Date.now() / ms) * ms + 2 * ms);
}

test.beforeAll(async () => {
  await wipe();

  const user = await prisma.user.upsert({
    where: { username: USER.username },
    update: { passwordHash: await bcrypt.hash(USER.password, 10) },
    create: { username: USER.username, passwordHash: await bcrypt.hash(USER.password, 10) },
  });
  userId = user.id;

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "E2E day-ahead zone",
      currency: "EUR",
      intervalMinutes: INTERVAL_MINUTES,
      corridorPct: new Prisma.Decimal(40),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });
  zoneId = zone.id;

  const wallet = await prisma.wallet.create({
    data: {
      ownerUserId: userId,
      zoneId,
      currency: "EUR",
      kwhBalance: new Prisma.Decimal(0),
      fiatBalance: new Prisma.Decimal(100),
    },
  });
  walletId = wallet.id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: USER.username } });
  await prisma.$disconnect();
});

test("picks an interval ahead, bids on it, sees the reserve and withdraws", async ({ page }) => {
  const target = futureInterval();

  await signInWithPassword(page, USER);
  await page.goto(`/en/exchange?zone=${ZONE_CODE}`);

  // The strip offers the intervals still on offer; pick one two slots out.
  const cell = page.getByTestId(`interval-${target.toISOString()}`);
  await expect(cell).toBeVisible();
  await cell.click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("interval"))
    .toBe(target.toISOString());

  // A limit bid for that interval: 10 kWh at 0.2000 EUR/kWh.
  await page.getByPlaceholder("100.000").fill("10");
  await page.getByPlaceholder("0.2000").fill("0.2000");
  await expect(page.locator("text=Funds reserved")).toBeVisible();
  await page.locator('form button[type="submit"]').first().click();

  // The money is held against the resting order (§12 "резерв средств").
  // Wait for the order to reach the list rather than for a label in the
  // ticket: "Funds reserved" is printed there before anything is placed.
  await expect(page.locator("text=No orders in this zone")).toHaveCount(0);
  const order = await prisma.order.findFirstOrThrow({
    where: { walletId, status: "NEW" },
    orderBy: { createdAt: "desc" },
  });
  expect(order.intervalStart?.toISOString()).toBe(target.toISOString());
  expect(Number(order.reservedFiat)).toBeGreaterThan(0);
  const held = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  expect(Number(held.reservedFiat)).toBe(Number(order.reservedFiat));

  // The strip now shows the trader's own volume on that interval.
  await expect(cell).toContainText("10.000");

  // Withdrawal before the interval starts releases the hold.
  page.once("dialog", (d) => d.accept());
  await page.locator('button:has-text("Cancel")').first().click();
  await expect(page.locator("text=CANCELLED").first()).toBeVisible();

  const freed = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  expect(Number(freed.reservedFiat)).toBe(0);
});

test("offers no withdrawal for an order whose interval has already started", async ({ page }) => {
  const ms = INTERVAL_MINUTES * 60 * 1000;
  const started = new Date(Math.floor(Date.now() / ms) * ms - ms);
  const order = await prisma.order.create({
    data: {
      walletId,
      zoneId,
      side: "BUY",
      type: "LIMIT",
      intervalStart: started,
      amountKwh: new Prisma.Decimal(5),
      limitPrice: new Prisma.Decimal(0.2),
      reservedFiat: new Prisma.Decimal(1.01),
    },
  });

  await signInWithPassword(page, USER);
  await page.goto(`/en/exchange?zone=${ZONE_CODE}`);

  await expect(page.locator("text=Delivery has started")).toBeVisible();
  await expect(page.locator('button:has-text("Cancel")')).toHaveCount(0);

  await prisma.order.delete({ where: { id: order.id } });
});
