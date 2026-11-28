// §48 на живой сборке: диспетчер заводит наряд руками, видит подбор с
// причиной и загрузкой, отдаёт наряд бригаде — и участник бригады находит его
// у себя, и в кабинете, и в телефоне.
//
// Бригада здесь создаётся через врезку на странице сотрудников §47, а не
// через prisma: иначе проверялась бы только очередь, а рабочее место, где
// бригаду собирают, осталось бы без проверки.

import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { BUILT_IN_ROLES } from "@/lib/staff/staff-service";
import { signInWithPassword } from "./login";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_disp_owner", password: "Pass1234" };
const ENGINEER = { username: "e2e_disp_engineer", password: "Pass1234" };
const SPARE = { username: "e2e_disp_spare", password: "Pass1234" };
const SLUG = "e2e-disp-network";
const CITY = "Prešov";
const CREW_NAME = "E2E night crew";

let operatorId: string;
let pointId: string;
let engineerEmployeeId: string;
let crewId: string;
let orderId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.crewMember.deleteMany({ where: { crew: { operator: { slug: SLUG } } } });
  await prisma.workOrderTask.deleteMany({
    where: { workOrder: { operator: { slug: SLUG } } },
  });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.crew.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(OWNER.password, 10);
  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: name },
        update: { passwordHash: hash },
        create: { username: name, passwordHash: hash },
      })
    ).id;
  const ownerId = await user(OWNER.username);
  const engineerId = await user(ENGINEER.username);
  const spareId = await user(SPARE.username);

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Dispatch Network",
        claimedById: ownerId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "E2E Dispatch Point", city: CITY },
    })
  ).id;

  const spec = BUILT_IN_ROLES.find((r) => r.name === "ENGINEER")!;
  const role = await prisma.staffRole.create({
    data: { operatorId, name: spec.name, permissions: spec.permissions, builtIn: true },
  });
  engineerEmployeeId = (
    await prisma.employee.create({
      data: { operatorId, userId: engineerId, roleId: role.id, pointIds: [], regions: [] },
    })
  ).id;
  // Второй инженер нужен, чтобы в подборе было из кого выбирать: список из
  // одного человека не доказывает ни порядок, ни причину.
  await prisma.employee.create({
    data: { operatorId, userId: spareId, roleId: role.id, pointIds: [], regions: ["Wien"] },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER.username, ENGINEER.username, SPARE.username] } },
  });
  await prisma.$disconnect();
});

test("the owner gives an engineer a city and builds a crew on the staff page", async ({
  page,
}) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/staff`);

  const editor = page.getByTestId("crew-editor");
  await expect(editor).toBeVisible();

  await page.getByTestId(`crew-employee-regions-${ENGINEER.username}`).fill(CITY);
  await editor.getByRole("button", { name: "Save" }).first().click();
  await expect
    .poll(async () => {
      const e = await prisma.employee.findUniqueOrThrow({ where: { id: engineerEmployeeId } });
      return e.regions.join(",");
    })
    .toBe(CITY);

  await page.getByTestId("crew-new-name").fill(CREW_NAME);
  await page.getByTestId("crew-new-regions").fill(CITY);
  await page.getByTestId("crew-add").click();
  await expect.poll(async () => prisma.crew.count({ where: { operatorId } })).toBe(1);
  crewId = (await prisma.crew.findFirstOrThrow({ where: { operatorId } })).id;

  await page.reload();
  await page.getByTestId(`crew-member-pick-${crewId}`).selectOption(engineerEmployeeId);
  await page.getByTestId(`crew-member-add-${crewId}`).click();
  await expect.poll(async () => prisma.crewMember.count({ where: { crewId } })).toBe(1);

  await page.reload();
  await expect(page.getByTestId("crew-list")).toContainText(CREW_NAME);
  await expect(page.getByTestId("crew-list")).toContainText(ENGINEER.username);
});

test("a dispatcher creates an order by hand and it lands in the queue unassigned", async ({
  page,
}) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/dispatch`);

  await expect(
    page.getByTestId("dispatch-queue").or(page.getByTestId("dispatch-empty")),
  ).toBeVisible();
  await expect(page.getByTestId("dispatch-create")).toBeVisible();

  await page.getByTestId("dispatch-title").fill("E2E: the gun does not lock");
  await page.getByTestId("dispatch-description").fill("The CCS2 gun will not latch");
  await page.getByTestId("dispatch-submit").click();

  await expect.poll(async () => prisma.workOrder.count({ where: { operatorId } })).toBe(1);
  const order = await prisma.workOrder.findFirstOrThrow({ where: { operatorId } });
  orderId = order.id;
  // Ручное создание не назначает само — §48 отдаёт выбор тому, кто заводит.
  expect(order.assigneeId).toBeNull();
  expect(order.crewId).toBeNull();
  expect(order.status).toBe("NEW");

  await page.reload();
  const queue = page.getByTestId("dispatch-queue");
  await expect(queue).toContainText("E2E: the gun does not lock");
  await expect(queue).toContainText("Unassigned");
});

test("the suggestion says why and how busy, and the crew of the city comes first", async ({
  page,
}) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/dispatch`);

  await page.getByTestId("dispatch-queue").getByRole("button", { name: "Assign" }).first().click();

  const list = page.getByTestId("dispatch-candidates");
  await expect(list).toBeVisible();
  await expect(list).toContainText("the order's city");
  await expect(list).toContainText(CREW_NAME);
  // Инженер другого города всё равно в списке — в три часа ночи кто-то едет.
  await expect(list).toContainText(SPARE.username);

  // Город наряда стоит выше чужого региона.
  const rows = await list.locator("li").allInnerTexts();
  const cityRow = rows.findIndex((r) => r.includes("the order's city"));
  const farRow = rows.findIndex((r) => r.includes(SPARE.username));
  expect(cityRow).toBeGreaterThanOrEqual(0);
  expect(cityRow).toBeLessThan(farRow);

  await expect(page.getByTestId("dispatch-load")).toContainText(CREW_NAME);
});

test("assigning the crew makes the order every member's order", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/dispatch`);

  await page.getByTestId("dispatch-queue").getByRole("button", { name: "Assign" }).first().click();
  const list = page.getByTestId("dispatch-candidates");
  await expect(list).toBeVisible();
  await list
    .locator("li")
    .filter({ hasText: CREW_NAME })
    .getByRole("button", { name: "Assign" })
    .click();

  await expect
    .poll(async () => {
      const o = await prisma.workOrder.findUniqueOrThrow({ where: { id: orderId } });
      return `${o.status}:${o.crewId ?? "-"}`;
    })
    .toBe(`ASSIGNED:${crewId}`);
});

test("the crew member finds the order in the cabinet and on the phone", async ({ page }) => {
  await signInWithPassword(page, ENGINEER);

  await page.goto("/en/me/work-orders");
  await expect(page.getByTestId("work-order-list")).toContainText("E2E: the gun does not lock");

  await page.goto("/en/app/work-orders");
  await expect(page.getByTestId("mobile-work-order-list")).toContainText(
    "E2E: the gun does not lock",
  );
});
