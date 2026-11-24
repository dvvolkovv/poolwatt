// US-01 / US-02 end to end: a producer registers a company, uploads a PDF,
// sends it for review, the operator approves, the producer sees the result.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PRODUCER = { username: "e2e_listing_producer", password: "Pass1234" };
const OPERATOR = { username: "e2e_listing_operator", password: "Pass1234" };
const REG_NUMBER = "E2E-LISTING-0001";
const COMPANY = "E2E Listing Energy s.r.o.";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<< >>\nendobj\ntrailer\n%%EOF\n");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const hash = await bcrypt.hash(PRODUCER.password, 10);
  await prisma.user.upsert({
    where: { username: PRODUCER.username },
    update: { passwordHash: hash },
    create: { username: PRODUCER.username, passwordHash: hash },
  });
  await prisma.user.upsert({
    where: { username: OPERATOR.username },
    update: { passwordHash: hash, role: "ADMIN" },
    create: { username: OPERATOR.username, passwordHash: hash, role: "ADMIN" },
  });
  await prisma.company.deleteMany({ where: { regNumber: REG_NUMBER } });
});

test.afterAll(async () => {
  await prisma.company.deleteMany({ where: { regNumber: REG_NUMBER } });
  await prisma.user.deleteMany({
    where: { username: { in: [PRODUCER.username, OPERATOR.username] } },
  });
  await prisma.$disconnect();
});

test("producer lists a company, operator approves it", async ({ page }) => {
  await signInWithPassword(page, PRODUCER);

  await page.goto("/en/me/listing");
  await page.click('button:has-text("Register a company")');
  await page.fill('input[name="legalName"]', COMPANY);
  await page.fill('input[name="country"]', "SK");
  await page.fill('input[name="regNumber"]', REG_NUMBER);
  await page.fill('input[name="contactEmail"]', "listing@example.com");
  await page.click('button[type="submit"]');

  await page.waitForURL(/\/en\/me\/listing\/[a-z0-9]+$/);
  const companyUrl = page.url();
  await expect(page.getByRole("heading", { level: 1, name: COMPANY })).toBeVisible();

  // US-01 — the application cannot be sent with no papers at all.
  await expect(page.locator('button:has-text("Send for review")')).toBeDisabled();

  await page.setInputFiles('input[type="file"]', {
    name: "licence.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await expect(page.locator('a:has-text("licence.pdf")')).toBeVisible();

  // The document is served by an authenticated route, not from /public.
  const href = await page.locator('a:has-text("licence.pdf")').getAttribute("href");
  expect(href).toMatch(/^\/api\/v1\/listing-applications\/[a-z0-9]+\/documents\/[a-f0-9]+$/);
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("application/pdf");

  await page.click('button:has-text("Send for review")');
  await expect(page.locator("text=The application is with the operator")).toBeVisible();

  // US-02 — the operator reviews and approves.
  const application = await prisma.listingApplication.findFirstOrThrow({
    where: { company: { regNumber: REG_NUMBER } },
    orderBy: { createdAt: "desc" },
  });
  expect(application.status).toBe("SUBMITTED");

  await page.context().clearCookies();
  await signInWithPassword(page, OPERATOR);
  await page.goto(`/en/admin/listings/${application.id}`);
  await expect(page.locator('a:has-text("licence.pdf")')).toBeVisible();
  await page.fill('textarea[name="screeningNote"]', "E2E: no sanctions hit");
  await page.click('button:has-text("Approve")');

  await expect
    .poll(async () =>
      (
        await prisma.listingApplication.findUniqueOrThrow({ where: { id: application.id } })
      ).status,
    )
    .toBe("APPROVED");

  // Back as the producer: the decision is on the page.
  await page.context().clearCookies();
  await signInWithPassword(page, PRODUCER);
  await page.goto(companyUrl);
  await expect(page.locator("text=Listing passed")).toBeVisible();
});
