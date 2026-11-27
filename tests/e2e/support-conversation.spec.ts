// §48 и §51 на живой сборке: водитель сообщает о поломке с фотографией,
// следит за своей заявкой, поддержка отвечает и решает её словами, водитель
// пишет снова и заявка открывается заново. Чужая заявка — 404, фотография
// заявителю отдаётся, постороннему нет.

import { test, expect } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { signInWithPassword } from "./login";
import { notifyRecoveredTickets } from "../../src/lib/work/ticket-recovery";

const prisma = new PrismaClient();

const DRIVER = { username: "e2e_sup_driver", password: "Pass1234" };
const SUPPORT = { username: "e2e_sup_agent", password: "Pass1234" };
const STRANGER = { username: "e2e_sup_stranger", password: "Pass1234" };
const OWNER = { username: "e2e_sup_owner", password: "Pass1234" };
const SLUG = "e2e-support-conversation";

let operatorId: string;
let pointId: string;
let connectorId: string;
let driverUserId: string;
let ticketId: string;
let photoKey: string | undefined;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.ticketMessage.deleteMany({
    where: { ticket: { operator: { slug: SLUG } } },
  });
  await prisma.ticket.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(DRIVER.password, 10);
  const user = async (username: string) =>
    (
      await prisma.user.upsert({
        where: { username },
        update: { passwordHash: hash },
        create: { username, passwordHash: hash },
      })
    ).id;
  driverUserId = await user(DRIVER.username);
  const supportUserId = await user(SUPPORT.username);
  await user(STRANGER.username);
  const ownerUserId = await user(OWNER.username);

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Support Network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "E2E Support Point",
      status: "PUBLISHED",
      publishedAt: new Date(),
      country: "SK",
      city: "Košice",
      addressLine: "Hlavná 9",
      latitude: 48.72,
      longitude: 21.25,
      howToFind: "by the pharmacy",
      energySource: "SOLAR",
      open24: true,
      paymentMethods: ["TOKEN"],
      connectors: {
        create: [
          {
            type: "CCS2",
            powerKw: new Prisma.Decimal(50),
            currentAc: false,
            quantity: 1,
            status: "FREE",
          },
        ],
      },
      tariffs: { create: [{ fromMinute: 0, toMinute: 1440, priceFiat: 0.4, currency: "EUR" }] },
    },
    include: { connectors: true },
  });
  pointId = point.id;
  connectorId = point.connectors[0].id;

  // §47 — the support agent of this network, the role that until now had
  // nothing to do on its own page.
  const role = await prisma.staffRole.create({
    data: {
      operatorId,
      name: "SUPPORT",
      permissions: ["points.read", "tickets.read", "tickets.write", "workorders.read"],
      builtIn: true,
    },
  });
  await prisma.employee.create({
    data: { operatorId, userId: supportUserId, roleId: role.id, pointIds: [] },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

test("the driver reports a fault with a photo and can follow the ticket", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  await page.goto(`/en/c/${pointId}/report`);

  // §51.4 — a photo from the spot. The type button is what sends, so the file
  // is chosen first.
  await page.setInputFiles('[data-testid="report-photos"]', {
    name: "cable.png",
    mimeType: "image/png",
    buffer: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 5),
    ]),
  });
  await expect(page.locator('[data-testid="photo-count"]')).toHaveText("1");

  await page.fill('textarea[aria-label="Anything to add (optional)"]', "Cable will not lock");
  await page.locator('[data-testid="report-DAMAGED_CABLE"]').click();
  await expect(page.locator('[data-testid="report-sent"]')).toBeVisible();

  // §51.5 — from here the person lands in their own ticket.
  await page.locator('[data-testid="follow-ticket"]').click();
  await page.waitForURL(/\/en\/me\/tickets\//);

  const ticket = await prisma.ticket.findFirstOrThrow({
    where: { operatorId, reporterId: driverUserId },
    orderBy: { createdAt: "desc" },
  });
  ticketId = ticket.id;
  photoKey = ticket.photos[0];
  expect(photoKey).toBeTruthy();

  // The comment is the first line of the conversation, and the system said a
  // repair order was opened (US-54).
  await expect(page.locator('[data-testid="ticket-thread"]')).toContainText(
    "Cable will not lock",
  );
  await expect(page.locator('[data-testid="ticket-thread"] [data-author="SYSTEM"]')).toBeVisible();
  await expect(page.locator('[data-testid="ticket-photos"] img')).toHaveCount(1);
});

test("the photo is served to the reporter and refused to a stranger", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  const mine = await page.request.get(`/api/v1/ticket-photos/${photoKey}`);
  expect(mine.status()).toBe(200);
  expect(mine.headers()["content-type"]).toContain("image/png");

  await page.context().clearCookies();
  await signInWithPassword(page, STRANGER);
  const theirs = await page.request.get(`/api/v1/ticket-photos/${photoKey}`);
  expect(theirs.status()).toBe(404);
});

test("a stranger cannot open the ticket at all", async ({ page }) => {
  await signInWithPassword(page, STRANGER);
  const response = await page.goto(`/en/me/tickets/${ticketId}`);
  expect(response?.status()).toBe(404);
});

test("support answers from the queue and the response time is stamped", async ({ page }) => {
  await signInWithPassword(page, SUPPORT);
  await page.goto(`/en/me/charger-operator/${operatorId}/tickets`);

  // §48 — the queue says who is still waiting for an answer.
  await expect(page.locator('[data-testid="ticket-queue"]')).toContainText("waiting for support");
  await page.locator(`[data-testid="ticket-link"][href*="${ticketId}"]`).click();
  await page.waitForURL(new RegExp(ticketId));

  await page.fill('[data-testid="ticket-reply"]', "An engineer is on the way");
  await page.locator('[data-testid="ticket-send"]').click();
  await expect(page.locator('[data-testid="ticket-thread"]')).toContainText(
    "An engineer is on the way",
  );

  const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  expect(after.firstRespondedAt).not.toBeNull();
  expect(after.status).toBe("IN_PROGRESS");
});

test("the driver sees the answer, support resolves it in words, and a reply reopens it", async ({
  page,
}) => {
  await signInWithPassword(page, DRIVER);
  await page.goto(`/en/me/tickets/${ticketId}`);
  await expect(page.locator('[data-testid="ticket-thread"]')).toContainText(
    "An engineer is on the way",
  );

  await page.context().clearCookies();
  await signInWithPassword(page, SUPPORT);
  await page.goto(`/en/me/charger-operator/${operatorId}/tickets/${ticketId}`);

  // Closing without words is impossible: the button stays disabled.
  await expect(page.locator('[data-testid="ticket-resolve"]')).toBeDisabled();
  await page.fill('[data-testid="ticket-reply"]', "Cable replaced, the station works");
  await page.locator('[data-testid="ticket-resolve"]').click();
  await expect(page.locator('[data-testid="ticket-status"]')).toHaveText("Resolved");

  await page.context().clearCookies();
  await signInWithPassword(page, DRIVER);
  await page.goto(`/en/me/tickets/${ticketId}`);
  await page.fill('[data-testid="ticket-reply"]', "Still not working");
  await page.locator('[data-testid="ticket-send"]').click();
  await expect(page.locator('[data-testid="ticket-thread"]')).toContainText("Still not working");

  const reopened = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  expect(reopened.status).toBe("IN_PROGRESS");
  expect(reopened.resolvedAt).toBeNull();
});

test("the API of §51 answers with the same tickets", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  const mine = await page.request.get("/api/v1/tickets/me");
  expect(mine.status()).toBe(200);
  const body = (await mine.json()) as { tickets: { id: string }[] };
  expect(body.tickets.map((t) => t.id)).toContain(ticketId);

  // §50 — the network's queue, and only to somebody who may read it.
  const queue = await page.request.get(`/api/v1/tickets?operatorId=${operatorId}`);
  expect(queue.status()).toBe(404);

  await page.context().clearCookies();
  await signInWithPassword(page, SUPPORT);
  const theirs = await page.request.get(`/api/v1/tickets?operatorId=${operatorId}`);
  expect(theirs.status()).toBe(200);
  const queued = (await theirs.json()) as { tickets: { id: string }[] };
  expect(queued.tickets.map((t) => t.id)).toContain(ticketId);
});

test("the connector was taken out of service and the recovery notice waits for the repair", async () => {
  const connector = await prisma.pointConnector.findUniqueOrThrow({
    where: { id: connectorId },
  });
  expect(connector.status).toBe("OUT_OF_SERVICE");

  expect(await notifyRecoveredTickets(new Date(), { sendTo: async () => undefined })).toBe(0);

  await prisma.pointConnector.update({
    where: { id: connectorId },
    data: { status: "FREE" },
  });
  const told = await notifyRecoveredTickets(new Date(), { sendTo: async () => undefined });
  expect(told).toBeGreaterThanOrEqual(1);

  const messages = await prisma.ticketMessage.findMany({
    where: { ticketId, authorKind: "SYSTEM" },
  });
  expect(messages.some((m) => m.body.includes("working again"))).toBe(true);
});
