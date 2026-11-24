// US-24 — "заполнить карточку через мастер", on the live build. The three
// criteria: required fields are checked, there is a preview, and submission
// goes to moderation.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_point_owner", password: "Pass1234" };
const ADMIN = { username: "e2e_point_admin", password: "Pass1234" };
const SLUG = "e2e-point-network";
const ZONE_CODE = "E2EPOINT";

let operatorId: string;
let zoneId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

test.beforeAll(async () => {
  await wipe();
  const hash = await bcrypt.hash(OWNER.password, 10);
  const owner = await prisma.user.upsert({
    where: { username: OWNER.username },
    update: { passwordHash: hash },
    create: { username: OWNER.username, passwordHash: hash },
  });
  await prisma.user.upsert({
    where: { username: ADMIN.username },
    update: { passwordHash: hash, role: "ADMIN" },
    create: { username: ADMIN.username, passwordHash: hash, role: "ADMIN" },
  });

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "E2E point zone", currency: "EUR" },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Point Network",
        claimedById: owner.id,
        claimedAt: new Date(),
      },
    })
  ).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [OWNER.username, ADMIN.username] } } });
  await prisma.$disconnect();
});

test("fills the card through the wizard, cannot submit early, and reaches moderation", async ({
  page,
}) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/points`);

  // Step one creates the draft row (§29.2), so nothing is lost on the way.
  await page.getByLabel("Name").fill("E2E Depot");
  await page.locator('button:has-text("Create")').click();
  await expect(page.getByTestId("point-status")).toHaveText("Draft");

  // The preview is there from the first screen.
  await expect(page.getByTestId("point-preview")).toContainText("E2E Depot");

  // Jump straight to the last step: submission must be refused while the
  // required fields of §28 are missing.
  await page.locator('button:has-text("7. Publish")').click();
  await expect(page.getByTestId("missing-fields")).toContainText("coordinates");
  await expect(page.getByTestId("submit-point")).toBeDisabled();

  // Address.
  await page.locator('button:has-text("2. Address")').click();
  await page.getByLabel("Country").fill("SK");
  await page.getByLabel("City").fill("Bratislava");
  await page.getByLabel("Address", { exact: true }).fill("Hlavná 1");
  await page.getByLabel("Latitude").fill("48.1486");
  await page.getByLabel("Longitude").fill("17.1077");
  await page.getByLabel("Grid zone").selectOption({ label: `${ZONE_CODE} · E2E point zone` });
  await page.getByLabel("How to find it").fill("Level -1, behind the lifts");

  // Equipment.
  await page.getByTestId("wizard-next").click();
  await page.getByLabel("Energy source").selectOption("SOLAR");
  await page.locator('button:has-text("add connector")').click();
  await page.getByLabel("Connector type 1").selectOption("CCS2");
  await page.getByLabel("Power, kW 1").fill("50");
  await page.getByLabel("Quantity 1").fill("2");

  // Tariffs.
  await page.getByTestId("wizard-next").click();
  await page.locator('button:has-text("add tariff")').click();
  await page.getByLabel("Price, money 1").fill("0.39");
  await page.getByLabel("Price, tokens 1").fill("1");

  // Payment, amenities, visibility, hours.
  await page.getByTestId("wizard-next").click();
  await page.getByLabel("kWh tokens").check();
  await page.getByLabel("Open 24/7").check();

  // Connection, then publish.
  await page.getByTestId("wizard-next").click();
  await page.getByLabel("Meter id").fill("E2E-METER-1");
  await page.getByTestId("wizard-next").click();

  // The preview now shows what a driver would see.
  await expect(page.getByTestId("point-preview")).toContainText("CCS2");
  await expect(page.getByTestId("point-preview")).toContainText("Bratislava");

  await expect(page.getByTestId("missing-fields")).toContainText(
    "Everything required is filled in",
  );
  await page.getByTestId("submit-point").click();
  await expect(page.getByTestId("point-status")).toHaveText("In review");

  const stored = await prisma.acceptancePoint.findFirstOrThrow({ where: { operatorId } });
  expect(stored.status).toBe("REVIEW");
  expect(stored.latitude).toBeCloseTo(48.1486, 4);
});

test("the operator approves it into test connection, not into the navigator", async ({ page }) => {
  await signInWithPassword(page, ADMIN);
  await page.goto("/en/admin/points");

  await expect(page.getByTestId("admin-point-queue")).toContainText("E2E Depot");
  await page.locator('a:has-text("E2E Depot")').click();
  await expect(page.getByTestId("admin-point-fields")).toContainText("Hlavná 1");

  await page.locator('button:has-text("Approve")').click();

  await expect(page.locator("text=Test connection").first()).toBeVisible();
  const stored = await prisma.acceptancePoint.findFirstOrThrow({ where: { operatorId } });
  // §29.4 — the navigator waits for the equipment's first word.
  expect(stored.status).toBe("TEST");
  expect(stored.publishedAt).toBeNull();
});

test("a rejection needs a reason the owner can act on", async ({ page }) => {
  const point = await prisma.acceptancePoint.findFirstOrThrow({ where: { operatorId } });
  await prisma.acceptancePoint.update({
    where: { id: point.id },
    data: { status: "REVIEW" },
  });

  await signInWithPassword(page, ADMIN);
  await page.goto(`/en/admin/points/${point.id}`);

  const reject = page.locator('button:has-text("Send back")');
  await expect(reject).toBeDisabled();

  await page.getByLabel("A note the owner can act on").fill("The photo is of a different address");
  await expect(reject).toBeEnabled();
  await reject.click();

  // The decision form is only rendered while the point is in review, so its
  // disappearance is the signal that the server has answered.
  await expect(page.getByTestId("point-decision")).toHaveCount(0);

  const stored = await prisma.acceptancePoint.findUniqueOrThrow({ where: { id: point.id } });
  expect(stored.status).toBe("DRAFT");
  expect(stored.reviewNote).toBe("The photo is of a different address");
});
