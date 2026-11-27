// §51.5 на телефоне, на живой сборке: раздел «Поддержка» в хабе §22, своя
// заявка, ответ поддержки видно без перезагрузки руками, и человек отвечает
// с телефона.

import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { signInWithPassword } from "./login";

const prisma = new PrismaClient();

const DRIVER = { username: "e2e_msup_driver", password: "Pass1234" };
const SUPPORT = { username: "e2e_msup_agent", password: "Pass1234" };
const OWNER = { username: "e2e_msup_owner", password: "Pass1234" };
const SLUG = "e2e-msup-network";

let operatorId: string;
let pointId: string;
let driverUserId: string;
let supportUserId: string;
let ticketId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.ticketMessage.deleteMany({ where: { ticket: { operator: { slug: SLUG } } } });
  await prisma.ticket.deleteMany({ where: { operator: { slug: SLUG } } });
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
  supportUserId = await user(SUPPORT.username);
  const ownerUserId = await user(OWNER.username);

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Mobile Support",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId,
        type: "CHARGING_STATION",
        name: "E2E Mobile Support Point",
        status: "PUBLISHED",
        publishedAt: new Date(),
        country: "SK",
        city: "Košice",
      },
    })
  ).id;

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

  // «Занято чужой машиной» — не поломка: ни наряда, ни вывода разъёма из
  // строя, только разговор, который и проверяется.
  ticketId = (
    await prisma.ticket.create({
      data: {
        operatorId,
        pointId,
        reporterId: driverUserId,
        problemType: "BLOCKED",
        respondBy: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    })
  ).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

test("the hub of §22 has a Support section leading to my tickets", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  await page.goto("/en/app/more");
  const link = page.locator('[data-section="support"]');
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(/\/en\/app\/tickets$/);
  await expect(page.locator('[data-testid="my-tickets"]')).toContainText("Blocked");
});

test("the driver opens the ticket and answers support from the phone", async ({ page }) => {
  await signInWithPassword(page, SUPPORT);
  // Поддержка отвечает с монитора — телефон должен увидеть этот ответ.
  await page.goto(`/en/me/charger-operator/${operatorId}/tickets/${ticketId}`);
  await page.fill('[data-testid="ticket-reply"]', "We are calling the other driver");
  await page.locator('[data-testid="ticket-send"]').click();
  await expect(page.locator('[data-testid="ticket-thread"]')).toContainText(
    "We are calling the other driver",
  );

  await page.context().clearCookies();
  await signInWithPassword(page, DRIVER);
  await page.goto(`/en/app/tickets/${ticketId}`);
  await expect(page.locator('[data-testid="ticket-thread"]')).toContainText(
    "We are calling the other driver",
  );

  await page.fill('[data-testid="ticket-reply"]', "Thank you, I will wait");
  await page.locator('[data-testid="ticket-send"]').click();
  await expect(page.locator('[data-testid="ticket-thread"]')).toContainText(
    "Thank you, I will wait",
  );

  const messages = await prisma.ticketMessage.findMany({
    where: { ticketId },
    orderBy: { createdAt: "asc" },
  });
  expect(messages.map((m) => m.authorKind)).toEqual(["SUPPORT", "CUSTOMER"]);
});

test("the driver cannot resolve their own ticket: that is support's word", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  await page.goto(`/en/app/tickets/${ticketId}`);
  await expect(page.locator('[data-testid="ticket-resolve"]')).toHaveCount(0);
});

test("a ticket of somebody else is not there at all", async ({ page }) => {
  const other = await prisma.ticket.create({
    data: { operatorId, pointId, problemType: "OTHER" },
  });
  await signInWithPassword(page, DRIVER);
  const response = await page.goto(`/en/app/tickets/${other.id}`);
  expect(response?.status()).toBe(404);
});
