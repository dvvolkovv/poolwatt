import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const PREFIX = "e2e_match_";

const HOMEOWNER = { username: `${PREFIX}homeowner`, password: "Pass1234" };
const CONTRACTOR_USER = { username: `${PREFIX}ctr_owner`, password: "Pass1234" };

let buildRequestId: string;
let contractorId: string;

test.beforeAll(async () => {
  const ho = await prisma.user.upsert({
    where: { username: HOMEOWNER.username },
    update: {
      passwordHash: await bcrypt.hash(HOMEOWNER.password, 10),
      name: "E2E Homeowner",
      phone: "+421900111111",
    },
    create: {
      username: HOMEOWNER.username,
      passwordHash: await bcrypt.hash(HOMEOWNER.password, 10),
      name: "E2E Homeowner",
      phone: "+421900111111",
    },
  });

  const ctrUser = await prisma.user.upsert({
    where: { username: CONTRACTOR_USER.username },
    update: { passwordHash: await bcrypt.hash(CONTRACTOR_USER.password, 10) },
    create: {
      username: CONTRACTOR_USER.username,
      passwordHash: await bcrypt.hash(CONTRACTOR_USER.password, 10),
    },
  });

  await prisma.buildRequestClaim.deleteMany({});
  await prisma.buildRequest.deleteMany({ where: { user: { username: HOMEOWNER.username } } });
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });

  const ctr = await prisma.contractor.create({
    data: {
      slug: `${PREFIX}solarco`,
      entityType: "LEGAL_ENTITY",
      displayName: "MatchCo Solar s.r.o.",
      legalName: "MatchCo Solar Renewable s.r.o.",
      registrationNumber: "55667788",
      country: "SK",
      city: "Bratislava",
      workCategories: ["DESIGN", "INSTALLATION"],
      renewableTypes: ["SOLAR"],
      countriesServed: ["SK"],
      bio: "We design and install rooftop solar systems for residential and commercial clients across Slovakia.",
      contactEmail: "info@matchco-solar.test",
      contactPhone: "+421900222222",
      status: "APPROVED",
      members: { create: { userId: ctrUser.id, role: "OWNER" } },
    },
  });
  contractorId = ctr.id;

  const br = await prisma.buildRequest.create({
    data: {
      userId: ho.id,
      source: "SOLAR",
      peakKw: 10,
      country: "SK",
      city: "Bratislava",
      addressLine: "Hlavná 99",
      siteType: "PRIVATE_HOUSE",
      roofOrientation: "S",
      budget: "FROM_15K_TO_30K",
      timeline: "URGENT_1_3M",
      status: "OPEN",
    },
  });
  buildRequestId = br.id;
});

test.afterAll(async () => {
  await prisma.buildRequestClaim.deleteMany({});
  await prisma.buildRequest.deleteMany({ where: { user: { username: HOMEOWNER.username } } });
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

test("contractor expresses interest → homeowner accepts → both see contacts", async ({ page }) => {
  await page.goto("/en/login");
  await page.fill('input[name="username"]', CONTRACTOR_USER.username);
  await page.fill('input[name="password"]', CONTRACTOR_USER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me(\/|$)/);

  await page.goto(`/en/me/contractor/${contractorId}/requests`);
  await expect(page.locator("text=Available build requests")).toBeVisible();
  await expect(page.locator("text=Solar").first()).toBeVisible();

  await page.locator('button:has-text("Express interest")').first().click();
  await page.fill('textarea', "We can deliver in 6 weeks with full turnkey.");
  await page.click('button:has-text("Send")');
  await expect(page.locator("text=You expressed interest")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.fill('input[name="username"]', HOMEOWNER.username);
  await page.fill('input[name="password"]', HOMEOWNER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me(\/|$)/);

  await page.goto(`/en/me/build-requests/${buildRequestId}`);
  await expect(page.locator("text=Interested contractors")).toBeVisible();
  await expect(page.locator("text=MatchCo Solar s.r.o.")).toBeVisible();
  await expect(page.locator("text=We can deliver in 6 weeks")).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.click('button:has-text("Accept this contractor")');

  await expect(page.locator("text=Your matched contractor")).toBeVisible();
  await expect(page.locator("text=info@matchco-solar.test")).toBeVisible();
  await expect(page.locator("text=+421900222222")).toBeVisible();
});
