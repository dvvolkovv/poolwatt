// §47 + §49 — «инженер … бронирует и списывает их по факту»: право на склад
// есть у владельца сети и у сотрудника с `warehouse.write`, и ни у кого ещё.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ensureBuiltInRoles } from "@/lib/staff/staff-service";
import { StockAccessError, requireStockActor } from "./stock-access";

const PREFIX = "test_stockacc_";

let operatorId: string;
let ownerUserId: string;
let engineerUserId: string;
let scopedUserId: string;
let accountantUserId: string;
let strangerUserId: string;
let pointA: string;
let pointB: string;

async function wipe() {
  await prisma.employee.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.staffRole.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  const user = async (name: string) =>
    (
      await prisma.user.create({
        data: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  ownerUserId = await user("owner");
  engineerUserId = await user("engineer");
  scopedUserId = await user("scoped");
  accountantUserId = await user("accountant");
  strangerUserId = await user("stranger");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Access network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointA = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "A" },
    })
  ).id;
  pointB = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "B" },
    })
  ).id;

  const roles = await ensureBuiltInRoles(operatorId);
  const role = (name: string) => roles.find((r) => r.name === name)!.id;
  await prisma.employee.create({
    data: { operatorId, userId: engineerUserId, roleId: role("ENGINEER"), pointIds: [] },
  });
  await prisma.employee.create({
    data: { operatorId, userId: scopedUserId, roleId: role("ENGINEER"), pointIds: [pointA] },
  });
  await prisma.employee.create({
    data: {
      operatorId,
      userId: accountantUserId,
      roleId: role("ACCOUNTANT"),
      pointIds: [],
    },
  });
});

afterAll(async () => {
  await wipe();
});

describe("requireStockActor", () => {
  it("lets the owner of the network through", async () => {
    const actor = await requireStockActor(operatorId, ownerUserId);
    expect(actor.isOwner).toBe(true);
    expect(actor.employee).toBeNull();
  });

  it("lets an engineer with warehouse.write through", async () => {
    const actor = await requireStockActor(operatorId, engineerUserId);
    expect(actor.isOwner).toBe(false);
    expect(actor.employee?.userId).toBe(engineerUserId);
  });

  it("refuses an accountant, who has no warehouse.write", async () => {
    await expect(requireStockActor(operatorId, accountantUserId)).rejects.toThrow(
      StockAccessError,
    );
  });

  it("refuses somebody who is not on this network at all", async () => {
    await expect(requireStockActor(operatorId, strangerUserId)).rejects.toThrow(
      StockAccessError,
    );
  });

  it("keeps an engineer to the points they were given", async () => {
    await expect(
      requireStockActor(operatorId, scopedUserId, { pointId: pointA }),
    ).resolves.toMatchObject({ isOwner: false });
    await expect(
      requireStockActor(operatorId, scopedUserId, { pointId: pointB }),
    ).rejects.toThrow(StockAccessError);
  });

  it("does not scope the owner by point", async () => {
    await expect(
      requireStockActor(operatorId, ownerUserId, { pointId: pointB }),
    ).resolves.toMatchObject({ isOwner: true });
  });

  it("refuses an unknown network", async () => {
    await expect(requireStockActor("nope", ownerUserId)).rejects.toThrow(StockAccessError);
  });
});
