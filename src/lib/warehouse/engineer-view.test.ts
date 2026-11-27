// §49 — «В наряде инженер видит нужные запчасти, их наличие у себя в машине
// и на ближайшем складе».

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ensureBuiltInRoles } from "@/lib/staff/staff-service";
import { readEngineerOrders, readEngineerStock } from "./engineer-view";

const PREFIX = "test_engview_";

let operatorId: string;
let ownerUserId: string;
let engineerUserId: string;
let strangerUserId: string;
let employeeId: string;
let vanId: string;
let otherVanId: string;
let centralId: string;
let partId: string;
let orderId: string;
let otherOrderId: string;
let crewOrderId: string;

async function wipe() {
  await prisma.stockMovement.deleteMany({
    where: { part: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.stockItem.deleteMany({
    where: { part: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.workOrder.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.warehouse.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.crew.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.sparePart.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
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
  strangerUserId = await user("stranger");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "View network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  const roles = await ensureBuiltInRoles(operatorId);
  employeeId = (
    await prisma.employee.create({
      data: {
        operatorId,
        userId: engineerUserId,
        roleId: roles.find((r) => r.name === "ENGINEER")!.id,
        pointIds: [],
      },
    })
  ).id;

  vanId = (
    await prisma.warehouse.create({
      data: { operatorId, name: "Van 1", kind: "VAN", keeperEmployeeId: employeeId },
    })
  ).id;
  otherVanId = (
    await prisma.warehouse.create({
      data: { operatorId, name: "Van 2", kind: "VAN" },
    })
  ).id;
  centralId = (
    await prisma.warehouse.create({
      data: { operatorId, name: "Central", kind: "CENTRAL", city: "Košice" },
    })
  ).id;
  partId = (
    await prisma.sparePart.create({
      data: { operatorId, sku: "CBL-1", name: "CCS2 cable", serialTracked: true },
    })
  ).id;
  await prisma.stockItem.create({ data: { warehouseId: vanId, partId, qty: 2 } });
  await prisma.stockItem.create({ data: { warehouseId: otherVanId, partId, qty: 7 } });
  await prisma.stockItem.create({ data: { warehouseId: centralId, partId, qty: 9 } });

  const point = await prisma.acceptancePoint.create({
    data: { operatorId, type: "CHARGING_STATION", name: "Point", city: "Košice" },
  });
  orderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: point.id,
        type: "REPAIR",
        title: "Mine",
        description: "Cable cut",
        partsNeeded: ["charging cable"],
        assigneeId: employeeId,
        status: "ASSIGNED",
      },
    })
  ).id;
  otherOrderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: point.id,
        type: "REPAIR",
        title: "Not mine",
        description: "Other",
      },
    })
  ).id;

  // §48 — наряд бригады, в которой этот инженер состоит.
  const crew = await prisma.crew.create({
    data: {
      operatorId,
      name: "Crew of one",
      regions: [],
      members: { create: [{ employeeId, lead: true }] },
    },
  });
  crewOrderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: point.id,
        type: "MAINTENANCE",
        title: "Ours as a crew",
        description: "Quarterly check",
        crewId: crew.id,
        status: "ASSIGNED",
      },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
});

describe("readEngineerOrders", () => {
  it("gives the engineer the orders assigned to them, personally and as a crew", async () => {
    const orders = await readEngineerOrders(engineerUserId);
    expect(orders.map((o) => o.id).sort()).toEqual([orderId, crewOrderId].sort());
    expect(orders[0].where).toContain("Point");
  });

  it("gives a stranger nothing", async () => {
    expect(await readEngineerOrders(strangerUserId)).toEqual([]);
  });

  it("gives the owner of the network every open order", async () => {
    const orders = await readEngineerOrders(ownerUserId);
    expect(orders.map((o) => o.id).sort()).toEqual(
      [orderId, otherOrderId, crewOrderId].sort(),
    );
  });
});

describe("readEngineerStock", () => {
  it("shows the engineer's own van first and the network's stores after it", async () => {
    const view = await readEngineerStock(orderId, engineerUserId);
    expect(view).not.toBeNull();
    expect(view!.warehouses[0]).toMatchObject({ id: vanId, mine: true });
    expect(view!.partsNeeded).toEqual(["charging cable"]);

    const inVan = view!.warehouses[0].items.find((i) => i.partId === partId);
    expect(inVan).toMatchObject({ qty: 2, serialTracked: true, sku: "CBL-1" });
  });

  it("hides another engineer's van: it is not a store this person may take from", async () => {
    const view = await readEngineerStock(orderId, engineerUserId);
    expect(view!.warehouses.map((w) => w.id)).toEqual([vanId, centralId]);
  });

  it("shows the owner every store, vans included", async () => {
    const view = await readEngineerStock(orderId, ownerUserId);
    expect(view!.warehouses.map((w) => w.id).sort()).toEqual(
      [vanId, otherVanId, centralId].sort(),
    );
  });

  it("refuses an order that is not this person's", async () => {
    expect(await readEngineerStock(otherOrderId, engineerUserId)).toBeNull();
  });

  it("refuses a stranger", async () => {
    expect(await readEngineerStock(orderId, strangerUserId)).toBeNull();
  });
});
