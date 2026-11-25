// US-25 on the live build: the owner writes one tariff and rolls it across
// every point of the network with one button.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_tmpl_owner", password: "Pass1234" };
const STRANGER = { username: "e2e_tmpl_stranger", password: "Pass1234" };
const SLUG = "e2e-tmpl-network";
const ZONE = "E2ETMPL";
const POINTS = 12;

let operatorId: string;
let zoneId: string;
let pointIds: string[] = [];

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.pointTemplate.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.pricingRule.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
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
    where: { username: STRANGER.username },
    update: { passwordHash: hash },
    create: { username: STRANGER.username, passwordHash: hash },
  });

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "E2E template zone", currency: "EUR" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Template Network",
        claimedById: owner.id,
        claimedAt: new Date(),
      },
    })
  ).id;

  await prisma.acceptancePoint.createMany({
    data: Array.from({ length: POINTS }, (_, i) => ({
      operatorId,
      type: "CHARGING_STATION" as const,
      name: `E2E T${String(i).padStart(2, "0")}`,
      status: "PUBLISHED" as const,
      gridZoneId: zoneId,
    })),
  });
  pointIds = (
    await prisma.acceptancePoint.findMany({
      where: { operatorId },
      orderBy: { name: "asc" },
      select: { id: true },
    })
  ).map((p) => p.id);

  // One point already has a different price, so the replace is visible.
  await prisma.pointTariff.create({
    data: {
      pointId: pointIds[0],
      fromMinute: 0,
      toMinute: 1440,
      priceFiat: new Prisma.Decimal(9.99),
      currency: "EUR",
    },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER.username, STRANGER.username] } },
  });
  await prisma.$disconnect();
});

test("the owner writes a template and applies it to every point (US-25)", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/templates`);

  await expect(page.getByTestId("template-form")).toBeVisible();

  const form = page.getByTestId("template-form");
  await form.getByLabel("Name", { exact: true }).fill("Winter 2026");
  await form.getByLabel("From h 1", { exact: true }).fill("0");
  await form.getByLabel("To h 1", { exact: true }).fill("7");
  await form.getByLabel("Price 1", { exact: true }).fill("0.21");
  await form.getByLabel("Tokens 1", { exact: true }).fill("0.9");
  await form.getByLabel("Co-op % 1", { exact: true }).fill("10");

  await form.getByRole("button", { name: "Add a window" }).click();
  await form.getByLabel("From h 2", { exact: true }).fill("7");
  await form.getByLabel("To h 2", { exact: true }).fill("24");
  await form.getByLabel("Price 2", { exact: true }).fill("0.47");
  await form.getByLabel("Tokens 2", { exact: true }).fill("1.3");

  await page.getByTestId("save-template").click();
  await expect
    .poll(async () =>
      prisma.pointTemplate.count({ where: { operatorId, name: "Winter 2026" } }),
    )
    .toBe(1);

  await page.reload();
  await expect(page.getByTestId("template-list")).toContainText("Winter 2026");

  const template = await prisma.pointTemplate.findFirstOrThrow({
    where: { operatorId, name: "Winter 2026" },
  });
  await page.getByTestId(`apply-all-${template.id}`).click();

  await expect(page.getByTestId(`applied-${template.id}`)).toContainText(String(POINTS));

  // Every point now carries both windows, and the old 9.99 is gone.
  expect(await prisma.pointTariff.count({ where: { point: { operatorId } } })).toBe(POINTS * 2);
  expect(
    await prisma.pointTariff.count({
      where: { point: { operatorId }, priceFiat: new Prisma.Decimal(9.99) },
    }),
  ).toBe(0);

  // §54 — a version for each point, naming the template.
  const versions = await prisma.pricingRule.findMany({
    where: { operatorId, scope: "POINT_TARIFF" },
  });
  expect(versions).toHaveLength(POINTS);
  expect(versions[0].note).toContain("Winter 2026");

  // §29.5 — nothing was un-published.
  expect(
    await prisma.acceptancePoint.count({ where: { operatorId, status: "PUBLISHED" } }),
  ).toBe(POINTS);
});

test("POST /v1/point-templates does it in one request", async ({ page }) => {
  await signInWithPassword(page, OWNER);

  const res = await page.request.post("/api/v1/point-templates", {
    data: {
      operatorId,
      name: "Summer 2026",
      tariffs: [{ fromMinute: 0, toMinute: 1440, priceFiat: 0.33, currency: "EUR" }],
      open24: true,
      apply: true,
      pointIds: pointIds.slice(0, 3),
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { template: { applied: number } };
  expect(body.template.applied).toBe(3);

  const changed = await prisma.pointTariff.findMany({
    where: { pointId: { in: pointIds.slice(0, 3) } },
  });
  expect(changed).toHaveLength(3);
  expect(Number(changed[0].priceFiat)).toBe(0.33);
});

test("a template belongs to its network", async ({ page }) => {
  await signInWithPassword(page, STRANGER);

  const res = await page.goto(`/en/me/charger-operator/${operatorId}/templates`);
  expect(res?.status()).toBe(404);

  const post = await page.request.post("/api/v1/point-templates", {
    data: {
      operatorId,
      name: "Theirs",
      tariffs: [{ fromMinute: 0, toMinute: 1440, priceFiat: 0.01, currency: "EUR" }],
    },
  });
  expect(post.status()).toBe(404);
});
