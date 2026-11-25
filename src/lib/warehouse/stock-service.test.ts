// §49 "Склад запчастей" and US-50 — "автоматическая заявка и уведомление"
// when a level falls below its minimum.
//
// The rule that holds the whole thing together: a stock level is the sum of
// its movements. Nothing writes `qty` by hand, so a level and its history
// cannot tell two different stories.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  StockError,
  closeRestockRequest,
  issueToWorkOrder,
  moveStock,
  readStock,
  receiveStock,
  recordStocktake,
  returnFaulty,
  setMinQty,
  writeOffStock,
} from "./stock-service";

const PREFIX = "test_stock_";

let operatorId: string;
let otherOperatorId: string;
let ownerUserId: string;
let strangerUserId: string;
let central: string;
let van: string;
let foreignWarehouse: string;
let cableId: string;
let foreignPartId: string;
let workOrderId: string;

async function wipe() {
  await prisma.restockRequest.deleteMany({
    where: { warehouse: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.stockMovement.deleteMany({
    where: { part: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.stockItem.deleteMany({
    where: { part: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.warehouse.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.sparePart.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();

  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: {},
        create: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  ownerUserId = await user("owner");
  strangerUserId = await user("stranger");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Stock network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  otherOperatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}other`, displayName: "Somebody else" },
    })
  ).id;

  central = (
    await prisma.warehouse.create({
      data: { operatorId, name: "Central", kind: "CENTRAL", city: "Košice" },
    })
  ).id;
  van = (
    await prisma.warehouse.create({ data: { operatorId, name: "Van 1", kind: "VAN" } })
  ).id;
  foreignWarehouse = (
    await prisma.warehouse.create({
      data: { operatorId: otherOperatorId, name: "Theirs", kind: "CENTRAL" },
    })
  ).id;

  cableId = (
    await prisma.sparePart.create({
      data: {
        operatorId,
        sku: "CBL-CCS2-5M",
        name: "CCS2 cable, 5 m",
        manufacturer: "Phoenix",
        compatibleModels: ["ABB Terra 54"],
        unitCostFiat: new Prisma.Decimal(180),
      },
    })
  ).id;
  foreignPartId = (
    await prisma.sparePart.create({
      data: { operatorId: otherOperatorId, sku: "X", name: "Theirs" },
    })
  ).id;

  const point = await prisma.acceptancePoint.create({
    data: { operatorId, type: "CHARGING_STATION", name: "Stock point" },
  });
  workOrderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: point.id,
        type: "REPAIR",
        title: "Replace the cable",
        description: "The cable is cut",
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.restockRequest.deleteMany({ where: { warehouse: { operatorId } } });
  await prisma.stockMovement.deleteMany({ where: { part: { operatorId } } });
  await prisma.stockItem.deleteMany({ where: { part: { operatorId } } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("receiveStock — §49's «приход»", () => {
  it("raises the level and leaves a movement behind", async () => {
    await receiveStock({
      partId: cableId,
      warehouseId: central,
      qty: 5,
      actorId: ownerUserId,
    });

    const item = await prisma.stockItem.findFirstOrThrow({
      where: { partId: cableId, warehouseId: central },
    });
    expect(item.qty).toBe(5);

    const movements = await prisma.stockMovement.findMany({ where: { partId: cableId } });
    expect(movements).toHaveLength(1);
    expect(movements[0].kind).toBe("RECEIPT");
    expect(movements[0].toWarehouseId).toBe(central);
  });

  it("adds to what is already there", async () => {
    await receiveStock({ partId: cableId, warehouseId: central, qty: 5, actorId: ownerUserId });
    await receiveStock({ partId: cableId, warehouseId: central, qty: 3, actorId: ownerUserId });

    const item = await prisma.stockItem.findFirstOrThrow({
      where: { partId: cableId, warehouseId: central },
    });
    expect(item.qty).toBe(8);
  });

  it("refuses nothing and refuses a negative", async () => {
    for (const qty of [0, -2]) {
      await expect(
        receiveStock({ partId: cableId, warehouseId: central, qty, actorId: ownerUserId }),
      ).rejects.toThrow(/more than zero/i);
    }
  });

  it("refuses a part and a warehouse that are not of one network", async () => {
    await expect(
      receiveStock({ partId: cableId, warehouseId: foreignWarehouse, qty: 1, actorId: ownerUserId }),
    ).rejects.toThrow(/network/i);
    await expect(
      receiveStock({ partId: foreignPartId, warehouseId: central, qty: 1, actorId: ownerUserId }),
    ).rejects.toThrow(StockError);
  });

  it("refuses a stranger", async () => {
    await expect(
      receiveStock({ partId: cableId, warehouseId: central, qty: 1, actorId: strangerUserId }),
    ).rejects.toThrow(StockError);
  });
});

describe("moveStock, issue, write-off, return — the rest of §49's operations", () => {
  beforeEach(async () => {
    await receiveStock({ partId: cableId, warehouseId: central, qty: 10, actorId: ownerUserId });
  });

  it("moves between warehouses without creating or destroying anything", async () => {
    await moveStock({
      partId: cableId,
      fromWarehouseId: central,
      toWarehouseId: van,
      qty: 4,
      actorId: ownerUserId,
    });

    const items = await prisma.stockItem.findMany({ where: { partId: cableId } });
    const byWarehouse = Object.fromEntries(items.map((i) => [i.warehouseId, i.qty]));
    expect(byWarehouse[central]).toBe(6);
    expect(byWarehouse[van]).toBe(4);
  });

  it("will not move more than is there", async () => {
    await expect(
      moveStock({
        partId: cableId,
        fromWarehouseId: central,
        toWarehouseId: van,
        qty: 11,
        actorId: ownerUserId,
      }),
    ).rejects.toThrow(/only 10|not enough/i);

    const item = await prisma.stockItem.findFirstOrThrow({
      where: { partId: cableId, warehouseId: central },
    });
    expect(item.qty).toBe(10);
  });

  it("issues a part to a work order and remembers which one", async () => {
    await issueToWorkOrder({
      partId: cableId,
      warehouseId: central,
      qty: 1,
      workOrderId,
      serialNo: "SN-12345",
      actorId: ownerUserId,
    });

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { partId: cableId, kind: "ISSUE" },
    });
    expect(movement.workOrderId).toBe(workOrderId);
    expect(movement.serialNo).toBe("SN-12345");
    // §49 — the cost rides along, for the cost of servicing the point.
    expect(Number(movement.unitCostFiat)).toBe(180);

    const item = await prisma.stockItem.findFirstOrThrow({
      where: { partId: cableId, warehouseId: central },
    });
    expect(item.qty).toBe(9);
  });

  it("writes off a part with a reason", async () => {
    await writeOffStock({
      partId: cableId,
      warehouseId: central,
      qty: 2,
      note: "Water damage in the store",
      actorId: ownerUserId,
    });

    const item = await prisma.stockItem.findFirstOrThrow({
      where: { partId: cableId, warehouseId: central },
    });
    expect(item.qty).toBe(8);
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { partId: cableId, kind: "WRITE_OFF" },
    });
    expect(movement.note).toMatch(/Water damage/);
  });

  it("asks why, before writing anything off", async () => {
    await expect(
      writeOffStock({ partId: cableId, warehouseId: central, qty: 1, note: " ", actorId: ownerUserId }),
    ).rejects.toThrow(/reason|why/i);
  });

  it("takes a faulty part back into the store it came from", async () => {
    await returnFaulty({
      partId: cableId,
      warehouseId: van,
      qty: 1,
      serialNo: "SN-999",
      actorId: ownerUserId,
    });

    const item = await prisma.stockItem.findFirstOrThrow({
      where: { partId: cableId, warehouseId: van },
    });
    expect(item.qty).toBe(1);
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { partId: cableId, kind: "RETURN_FAULTY" },
    });
    expect(movement.serialNo).toBe("SN-999");
  });

  it("records a stocktake as the difference it found, not as a new truth", async () => {
    // Ten on the books, eight on the shelf.
    await recordStocktake({
      partId: cableId,
      warehouseId: central,
      countedQty: 8,
      actorId: ownerUserId,
    });

    const item = await prisma.stockItem.findFirstOrThrow({
      where: { partId: cableId, warehouseId: central },
    });
    expect(item.qty).toBe(8);
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { partId: cableId, kind: "STOCKTAKE" },
    });
    // The movement is the correction, so the sum of movements still equals
    // the level.
    expect(movement.qty).toBe(-2);
  });

  it("records a stocktake that found nothing as nothing", async () => {
    await recordStocktake({
      partId: cableId,
      warehouseId: central,
      countedQty: 10,
      actorId: ownerUserId,
    });
    expect(await prisma.stockMovement.count({ where: { partId: cableId, kind: "STOCKTAKE" } })).toBe(0);
  });

  it("keeps the level equal to the sum of the movements", async () => {
    await moveStock({
      partId: cableId,
      fromWarehouseId: central,
      toWarehouseId: van,
      qty: 3,
      actorId: ownerUserId,
    });
    await issueToWorkOrder({
      partId: cableId,
      warehouseId: van,
      qty: 1,
      workOrderId,
      actorId: ownerUserId,
    });
    await writeOffStock({
      partId: cableId,
      warehouseId: central,
      qty: 2,
      note: "Damaged",
      actorId: ownerUserId,
    });

    for (const warehouseId of [central, van]) {
      const movements = await prisma.stockMovement.findMany({
        where: { partId: cableId, OR: [{ toWarehouseId: warehouseId }, { fromWarehouseId: warehouseId }] },
      });
      const sum = movements.reduce(
        (n, m) => n + (m.toWarehouseId === warehouseId ? m.qty : -m.qty),
        0,
      );
      const item = await prisma.stockItem.findFirstOrThrow({
        where: { partId: cableId, warehouseId },
      });
      expect(item.qty).toBe(sum);
    }
  });
});

describe("US-50 — the request raised when a level drops below its minimum", () => {
  beforeEach(async () => {
    await receiveStock({ partId: cableId, warehouseId: central, qty: 10, actorId: ownerUserId });
    await setMinQty({ partId: cableId, warehouseId: central, minQty: 5, actorId: ownerUserId });
  });

  it("raises nothing while the level is above the minimum", async () => {
    await issueToWorkOrder({
      partId: cableId,
      warehouseId: central,
      qty: 2,
      workOrderId,
      actorId: ownerUserId,
    });
    expect(await prisma.restockRequest.count({ where: { warehouseId: central } })).toBe(0);
  });

  it("raises one the moment the level crosses it", async () => {
    await issueToWorkOrder({
      partId: cableId,
      warehouseId: central,
      qty: 6,
      workOrderId,
      actorId: ownerUserId,
    });

    const request = await prisma.restockRequest.findFirstOrThrow({
      where: { warehouseId: central, partId: cableId },
    });
    expect(request.status).toBe("OPEN");
    expect(request.qtyAtRequest).toBe(4);
    expect(request.minQty).toBe(5);
    // Enough to get back to the minimum, and never less than one.
    expect(request.suggestedQty).toBe(1);
  });

  it("raises one request, not seven, while the level stays low", async () => {
    await issueToWorkOrder({
      partId: cableId,
      warehouseId: central,
      qty: 6,
      workOrderId,
      actorId: ownerUserId,
    });
    await issueToWorkOrder({
      partId: cableId,
      warehouseId: central,
      qty: 1,
      workOrderId,
      actorId: ownerUserId,
    });
    await issueToWorkOrder({
      partId: cableId,
      warehouseId: central,
      qty: 1,
      workOrderId,
      actorId: ownerUserId,
    });

    expect(
      await prisma.restockRequest.count({ where: { warehouseId: central, status: "OPEN" } }),
    ).toBe(1);
  });

  it("raises one again after the old request was dealt with", async () => {
    await issueToWorkOrder({
      partId: cableId,
      warehouseId: central,
      qty: 6,
      workOrderId,
      actorId: ownerUserId,
    });
    const first = await prisma.restockRequest.findFirstOrThrow({ where: { warehouseId: central } });
    await closeRestockRequest({ requestId: first.id, actorId: ownerUserId });

    // Topped up and run down again.
    await receiveStock({ partId: cableId, warehouseId: central, qty: 10, actorId: ownerUserId });
    await issueToWorkOrder({
      partId: cableId,
      warehouseId: central,
      qty: 12,
      workOrderId,
      actorId: ownerUserId,
    });

    expect(
      await prisma.restockRequest.count({ where: { warehouseId: central, status: "OPEN" } }),
    ).toBe(1);
  });

  it("raises one straight away when the minimum is set above what is there", async () => {
    await setMinQty({ partId: cableId, warehouseId: central, minQty: 20, actorId: ownerUserId });

    const request = await prisma.restockRequest.findFirstOrThrow({
      where: { warehouseId: central, status: "OPEN" },
    });
    expect(request.suggestedQty).toBe(10);
  });

  it("raises nothing when the minimum is zero — nobody asked to be told", async () => {
    await setMinQty({ partId: cableId, warehouseId: central, minQty: 0, actorId: ownerUserId });
    await issueToWorkOrder({
      partId: cableId,
      warehouseId: central,
      qty: 10,
      workOrderId,
      actorId: ownerUserId,
    });
    expect(await prisma.restockRequest.count({ where: { warehouseId: central } })).toBe(0);
  });

  it("writes the request to the audit log", async () => {
    await issueToWorkOrder({
      partId: cableId,
      warehouseId: central,
      qty: 6,
      workOrderId,
      actorId: ownerUserId,
    });
    const log = await prisma.auditLog.findFirst({
      where: { entity: "RestockRequest", action: "stock.restock.raised" },
      orderBy: { at: "desc" },
    });
    expect(log).not.toBeNull();
  });
});

describe("readStock — what the keeper and the engineer look at", () => {
  it("shows every warehouse's level, with the shortfall marked", async () => {
    await receiveStock({ partId: cableId, warehouseId: central, qty: 2, actorId: ownerUserId });
    await receiveStock({ partId: cableId, warehouseId: van, qty: 1, actorId: ownerUserId });
    await setMinQty({ partId: cableId, warehouseId: central, minQty: 5, actorId: ownerUserId });

    const view = await readStock(operatorId, ownerUserId);

    const centralRow = view.items.find(
      (i) => i.warehouseId === central && i.partId === cableId,
    )!;
    expect(centralRow.qty).toBe(2);
    expect(centralRow.minQty).toBe(5);
    expect(centralRow.below).toBe(true);
    expect(centralRow.partName).toBe("CCS2 cable, 5 m");

    const vanRow = view.items.find((i) => i.warehouseId === van && i.partId === cableId)!;
    expect(vanRow.below).toBe(false);

    expect(view.openRequests).toHaveLength(1);
    expect(view.warehouses.map((w) => w.name).sort()).toEqual(["Central", "Van 1"]);
  });

  it("says nothing about another network's store", async () => {
    await expect(readStock(operatorId, strangerUserId)).rejects.toThrow(StockError);
  });
});
