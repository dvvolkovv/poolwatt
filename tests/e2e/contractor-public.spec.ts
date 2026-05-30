import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const PREFIX = "e2e_pub_ctr_";

test.beforeAll(async () => {
  const owner = await prisma.user.upsert({
    where: { username: `${PREFIX}owner` },
    update: { passwordHash: await bcrypt.hash("Pass1234", 10) },
    create: { username: `${PREFIX}owner`, passwordHash: await bcrypt.hash("Pass1234", 10) },
  });

  // wipe any prior leftover
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });

  await prisma.contractor.create({
    data: {
      slug: `${PREFIX}solarco`,
      entityType: "LEGAL_ENTITY",
      displayName: "PublicCo Solar s.r.o.",
      legalName: "PublicCo Solar Renewable Energy s.r.o.",
      registrationNumber: "99887766",
      country: "SK",
      city: "Bratislava",
      foundedYear: 2018,
      workCategories: ["DESIGN", "INSTALLATION"],
      renewableTypes: ["SOLAR"],
      countriesServed: ["SK", "CZ"],
      bio: "We design and install solar power stations across Slovakia and Czech Republic. ".repeat(3),
      contactEmail: "info@publicco-solar.test",
      contactPhone: "+421900555111",
      websiteUrl: "https://publicco-solar.test",
      providesEvCharging: true,
      evPowerSource: "MIXED",
      evStationCount: 12,
      evConnectorTypes: ["CCS2", "TYPE2"],
      evPowerLevels: ["DC_FAST"],
      evUsageType: "PUBLIC",
      evMaxPowerKw: 150,
      evDescription: "Twelve DC fast chargers along the Bratislava–Vienna corridor, powered by rooftop solar plus grid backup. 24/7 public with mobile app activation.",
      status: "APPROVED",
      adminNote: "INTERNAL-ONLY-MUST-NOT-LEAK",
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  });

  // Also create a PENDING one to verify it does NOT show up
  await prisma.contractor.create({
    data: {
      slug: `${PREFIX}pending`,
      entityType: "INDIVIDUAL",
      displayName: "PublicCo Pending",
      country: "SK",
      city: "Bratislava",
      workCategories: ["INSTALLATION"],
      renewableTypes: ["WIND"],
      countriesServed: ["SK"],
      bio: "x".repeat(150),
      contactEmail: "x@x.test",
      contactPhone: "+421900555222",
      status: "PENDING",
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  });
});

test.afterAll(async () => {
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

test("anonymous visitor browses and views a contractor", async ({ page }) => {
  // Listing
  await page.goto("/en/contractors");
  await expect(page.locator("h1", { hasText: "Contractors" })).toBeVisible();
  await expect(page.locator("text=PublicCo Solar s.r.o.")).toBeVisible();
  // PENDING should NOT appear
  await expect(page.locator("text=PublicCo Pending")).not.toBeVisible();

  // Click through to detail
  await page.locator("text=PublicCo Solar s.r.o.").first().click();
  await expect(page).toHaveURL(/\/en\/contractors\/e2e_pub_ctr_solarco$/);
  await expect(page.locator("text=info@publicco-solar.test")).toBeVisible();
  await expect(page.locator("text=+421900555111")).toBeVisible();
  await expect(page.locator("text=https://publicco-solar.test")).toBeVisible();

  // adminNote must NEVER appear in HTML
  const html = await page.content();
  expect(html).not.toContain("INTERNAL-ONLY-MUST-NOT-LEAK");
});

test("non-approved slug returns 404", async ({ page }) => {
  const resp = await page.goto(`/en/contractors/${PREFIX}pending`);
  expect(resp?.status()).toBe(404);
});

test("homepage shows contractors block", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("text=Build your own power station")).toBeVisible();
  await expect(page.locator("text=PublicCo Solar s.r.o.")).toBeVisible();
});

test("country filter narrows results", async ({ page }) => {
  await page.goto("/en/contractors?country=CZ");
  // Our SK-only test row should be absent
  await expect(page.locator("text=PublicCo Solar s.r.o.")).not.toBeVisible();
});

test("listing card shows ⚡ EV badge for contractors providing EV charging", async ({ page }) => {
  await page.goto("/en/contractors");
  // Card text "EV" appears inside the EV badge chip
  await expect(page.locator("text=PublicCo Solar s.r.o.")).toBeVisible();
  // Badge text "EV" should appear at least once
  await expect(page.locator("text=EV").first()).toBeVisible();
});

test("?ev=true filter shows EV operators", async ({ page }) => {
  await page.goto("/en/contractors?ev=true");
  await expect(page.locator("text=PublicCo Solar s.r.o.")).toBeVisible();
});

test("public detail page renders EV section when providesEvCharging is true", async ({ page }) => {
  await page.goto(`/en/contractors/${PREFIX}solarco`);
  await expect(page.locator("text=EV Charging Infrastructure").first()).toBeVisible();
  await expect(page.locator("text=CCS2").first()).toBeVisible();
  await expect(page.locator("text=150").first()).toBeVisible();  // kW value
});
