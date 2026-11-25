// US-51 on the live build: the development manager's kanban, with the person
// answerable, the date, documents and comments.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_pipe_owner", password: "Pass1234" };
const STAFF = { username: "e2e_pipe_staff", password: "Pass1234" };
const SLUG = "e2e-pipe-network";

let operatorId: string;
let employeeId: string;
let leadId: string;

/** A 1×1 PNG, enough for the sniffer. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.leadNote.deleteMany({ where: { lead: { operator: { slug: SLUG } } } });
  await prisma.leadDocument.deleteMany({ where: { lead: { operator: { slug: SLUG } } } });
  await prisma.siteLead.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(OWNER.password, 10);
  const owner = await prisma.user.upsert({
    where: { username: OWNER.username },
    update: { passwordHash: hash },
    create: { username: OWNER.username, passwordHash: hash },
  });
  const staff = await prisma.user.upsert({
    where: { username: STAFF.username },
    update: { passwordHash: hash },
    create: { username: STAFF.username, passwordHash: hash, name: "Dana Development" },
  });

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Pipeline Network",
        claimedById: owner.id,
        claimedAt: new Date(),
      },
    })
  ).id;

  const role = await prisma.staffRole.create({
    data: { operatorId, name: "Development", permissions: ["POINTS_EDIT"] },
  });
  employeeId = (
    await prisma.employee.create({
      data: { operatorId, userId: staff.id, roleId: role.id },
    })
  ).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [OWNER.username, STAFF.username] } } });
  await prisma.$disconnect();
});

test("the manager adds a place, names who is answerable and by when (US-51)", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/pipeline`);

  // All seven of §48's columns are on the board, empty or not.
  for (const stage of [
    "SCOUTING",
    "NEGOTIATION",
    "CONTRACT",
    "DESIGN",
    "INSTALLATION",
    "COMMISSIONING",
    "PUBLISHED",
  ]) {
    await expect(page.getByTestId(`column-${stage}`)).toBeVisible();
  }

  const form = page.getByTestId("new-lead-form");
  await form.getByLabel("Place", { exact: true }).fill("Supermarket car park");
  await form.getByLabel("City", { exact: true }).fill("Košice");
  await form.getByLabel("Answerable", { exact: true }).selectOption(employeeId);
  // A date in the past, so the board shows it as overdue straight away.
  await form.getByLabel("Due", { exact: true }).fill("2026-01-10T10:00");
  await page.getByTestId("create-lead").click();

  await expect
    .poll(async () => prisma.siteLead.count({ where: { operatorId } }))
    .toBe(1);
  leadId = (await prisma.siteLead.findFirstOrThrow({ where: { operatorId } })).id;

  await page.reload();
  const card = page.getByTestId(`lead-${leadId}`);
  await expect(card).toContainText("Supermarket car park");
  await expect(card).toContainText("Dana Development");
  await expect(card).toContainText("overdue");
  await expect(page.getByTestId("pipeline-totals")).toContainText("1");
});

test("the card moves along the stages, and the move is kept", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/pipeline`);

  await page.getByTestId(`lead-${leadId}`).getByRole("button").first().click();
  await page
    .getByLabel("Stage Supermarket car park", { exact: true })
    .selectOption("CONTRACT");

  await expect
    .poll(async () => (await prisma.siteLead.findUniqueOrThrow({ where: { id: leadId } })).stage)
    .toBe("CONTRACT");

  const log = await prisma.auditLog.findFirst({
    where: { entity: "SiteLead", entityId: leadId, action: "lead.moved" },
  });
  expect(log).not.toBeNull();

  await page.reload();
  await expect(page.getByTestId("column-CONTRACT")).toContainText("Supermarket car park");
});

test("a document and a comment stay with the lead", async ({ page }) => {
  await signInWithPassword(page, OWNER);

  // The comment goes on from the board.
  await page.goto(`/en/me/charger-operator/${operatorId}/pipeline`);
  await page.getByTestId(`lead-${leadId}`).getByRole("button").first().click();
  await page
    .getByLabel("Comment Supermarket car park", { exact: true })
    .fill("Landlord wants a ten-year lease");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(async () => prisma.leadNote.count({ where: { leadId } })).toBe(1);

  // The document goes on from the lead's own page.
  await page.goto(`/en/me/charger-operator/${operatorId}/pipeline/${leadId}`);
  await page.getByLabel("Add a document", { exact: true }).setInputFiles({
    name: "lease.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect.poll(async () => prisma.leadDocument.count({ where: { leadId } })).toBe(1);

  await page.reload();
  await expect(page.getByTestId("lead-documents")).toContainText("lease.png");
  await expect(page.getByTestId("lead-notes")).toContainText("ten-year lease");

  // And it is readable by the network that owns it.
  const doc = await prisma.leadDocument.findFirstOrThrow({ where: { leadId } });
  const res = await page.request.get(`/api/v1/pipeline/documents/${doc.id}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
});

test("a lost lead keeps its card and its reason", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/pipeline`);

  await page.getByTestId(`lead-${leadId}`).getByRole("button").first().click();
  await page
    .getByLabel("Why it was lost Supermarket car park", { exact: true })
    .fill("Let to a supermarket");
  await page.getByTestId(`lose-lead-${leadId}`).click();

  await expect
    .poll(async () => (await prisma.siteLead.findUniqueOrThrow({ where: { id: leadId } })).lostAt)
    .not.toBeNull();

  await page.reload();
  await expect(page.getByTestId("pipeline-lost")).toContainText("Let to a supermarket");
  await expect(page.getByTestId("pipeline-totals")).toContainText("1");
});

test("the funnel and its documents belong to the network", async ({ page }) => {
  await signInWithPassword(page, STAFF);

  const board = await page.goto(`/en/me/charger-operator/${operatorId}/pipeline`);
  expect(board?.status()).toBe(404);

  const doc = await prisma.leadDocument.findFirstOrThrow({ where: { leadId } });
  const res = await page.request.get(`/api/v1/pipeline/documents/${doc.id}`);
  expect(res.status()).toBe(404);
});
