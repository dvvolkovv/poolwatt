// §49 "Склад запчастей" and US-50 — "автоматическая заявка и уведомление"
// when a level falls below its minimum.
//
// One rule holds the whole module together: **a stock level is the sum of its
// movements.** Every operation of §49 writes a movement and adjusts the level
// in the same transaction, nothing writes `qty` on its own, and a stocktake is
// recorded as the difference it found rather than as a new truth. That is what
// lets §16.11's nightly reconciliation check the two against each other.
//
// The restock request of US-50 is raised inside the same transaction as the
// movement that caused it, because a request raised "later" is a request that
// can be lost.

import type { Prisma, StockMovementKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Db, writeAudit } from "@/lib/exchange/audit";
import { StockAccessError, requireStockActor } from "./stock-access";

export class StockError extends Error {}

/**
 * §47 + §49 — the owner, or staff with `warehouse.write`. The decision itself
 * lives in `stock-access`; here it is only translated into the one error type
 * every route and page of the warehouse already catches.
 */
async function requireNetwork(operatorId: string, userId: string, pointId?: string | null) {
  try {
    return await requireStockActor(operatorId, userId, { pointId });
  } catch (err) {
    if (err instanceof StockAccessError) throw new StockError(err.message);
    throw err;
  }
}

/** A part and the warehouses it moves between all have to be one network's. */
async function requireSameNetwork(args: {
  partId: string;
  warehouseIds: (string | null | undefined)[];
  actorId: string;
  /** §47's scope, when the operation hangs off a point (a work order). */
  pointId?: string | null;
}) {
  const part = await prisma.sparePart.findUnique({
    where: { id: args.partId },
    select: { id: true, operatorId: true, unitCostFiat: true },
  });
  if (!part) throw new StockError("No such part");
  const actor = await requireNetwork(part.operatorId, args.actorId, args.pointId);

  const ids = args.warehouseIds.filter((id): id is string => Boolean(id));
  if (ids.length > 0) {
    const mine = await prisma.warehouse.count({
      where: { id: { in: ids }, operatorId: part.operatorId },
    });
    if (mine !== new Set(ids).size) {
      throw new StockError("That warehouse is not in the same network as the part");
    }
  }
  return { part, actor };
}

function requirePositive(qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new StockError(`A quantity has to be a whole number more than zero, got ${qty}`);
  }
}

/** Raise the level in one warehouse, creating the row if it is the first time. */
async function addToWarehouse(
  tx: Prisma.TransactionClient,
  args: { partId: string; warehouseId: string; delta: number },
): Promise<number> {
  const item = await tx.stockItem.upsert({
    where: { warehouseId_partId: { warehouseId: args.warehouseId, partId: args.partId } },
    update: { qty: { increment: args.delta } },
    create: { warehouseId: args.warehouseId, partId: args.partId, qty: args.delta },
  });
  return item.qty;
}

/** Lower the level, refusing to go past what is actually there. */
async function takeFromWarehouse(
  tx: Prisma.TransactionClient,
  args: { partId: string; warehouseId: string; qty: number },
): Promise<{ qty: number; minQty: number }> {
  const [locked] = await tx.$queryRaw<{ qty: number; minQty: number }[]>`
    SELECT qty, "minQty" FROM "StockItem"
    WHERE "warehouseId" = ${args.warehouseId} AND "partId" = ${args.partId}
    FOR UPDATE
  `;
  const have = locked?.qty ?? 0;
  if (have < args.qty) {
    throw new StockError(`Not enough on the shelf: only ${have} there, ${args.qty} asked for`);
  }

  const item = await tx.stockItem.update({
    where: { warehouseId_partId: { warehouseId: args.warehouseId, partId: args.partId } },
    data: { qty: { decrement: args.qty } },
  });
  return { qty: item.qty, minQty: item.minQty };
}

/**
 * US-50 — raise a request if this level has fallen below its minimum, and only
 * if there is not one open already: a level sitting low for a week is one
 * problem, not seven.
 */
async function maybeRaiseRestock(
  tx: Prisma.TransactionClient,
  args: { partId: string; warehouseId: string; qty: number; minQty: number },
): Promise<void> {
  // A minimum of zero means nobody asked to be told.
  if (args.minQty <= 0 || args.qty >= args.minQty) return;

  const open = await tx.restockRequest.findFirst({
    where: { warehouseId: args.warehouseId, partId: args.partId, status: "OPEN" },
    select: { id: true },
  });
  if (open) return;

  const request = await tx.restockRequest.create({
    data: {
      warehouseId: args.warehouseId,
      partId: args.partId,
      qtyAtRequest: args.qty,
      minQty: args.minQty,
      // Enough to get back to the minimum; never less than one, or the
      // request would ask for nothing.
      suggestedQty: Math.max(1, args.minQty - args.qty),
    },
  });

  await writeAudit(tx, {
    actor: "system",
    entity: "RestockRequest",
    entityId: request.id,
    action: "stock.restock.raised",
    after: {
      warehouseId: args.warehouseId,
      partId: args.partId,
      qty: args.qty,
      minQty: args.minQty,
      suggestedQty: request.suggestedQty,
    },
  });
}

interface MovementArgs {
  partId: string;
  kind: StockMovementKind;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  qty: number;
  workOrderId?: string | null;
  serialNo?: string | null;
  unitCostFiat?: Prisma.Decimal | null;
  note?: string | null;
  actorId: string;
}

async function writeMovement(tx: Prisma.TransactionClient, args: MovementArgs) {
  const movement = await tx.stockMovement.create({
    data: {
      partId: args.partId,
      kind: args.kind,
      fromWarehouseId: args.fromWarehouseId ?? null,
      toWarehouseId: args.toWarehouseId ?? null,
      qty: args.qty,
      workOrderId: args.workOrderId ?? null,
      serialNo: args.serialNo?.trim() || null,
      unitCostFiat: args.unitCostFiat ?? null,
      note: args.note?.trim() || null,
      actorId: args.actorId,
    },
  });

  // §49 — a movement is what puts a part's cost into the point's upkeep, so it
  // leaves a trace. Until US-49 only the US-50 request wrote to the journal,
  // and a write-off made by somebody else's hands and synced later is exactly
  // the case a journal is for.
  await writeAudit(tx, {
    actor: args.actorId,
    entity: "StockMovement",
    entityId: movement.id,
    action: `stock.movement.${args.kind}`,
    after: {
      partId: args.partId,
      qty: args.qty,
      fromWarehouseId: args.fromWarehouseId ?? null,
      toWarehouseId: args.toWarehouseId ?? null,
      workOrderId: args.workOrderId ?? null,
      serialNo: args.serialNo?.trim() || null,
    },
  });
  return movement;
}

/** §49 "приход" — a delivery from a supplier. */
export async function receiveStock(args: {
  partId: string;
  warehouseId: string;
  qty: number;
  note?: string | null;
  actorId: string;
}) {
  requirePositive(args.qty);
  const { part } = await requireSameNetwork({
    partId: args.partId,
    warehouseIds: [args.warehouseId],
    actorId: args.actorId,
  });

  return prisma.$transaction(async (tx) => {
    await addToWarehouse(tx, {
      partId: args.partId,
      warehouseId: args.warehouseId,
      delta: args.qty,
    });
    return writeMovement(tx, {
      partId: args.partId,
      kind: "RECEIPT",
      toWarehouseId: args.warehouseId,
      qty: args.qty,
      unitCostFiat: part.unitCostFiat,
      note: args.note,
      actorId: args.actorId,
    });
  });
}

/** §49 "перемещение" — between the central store, a region and a van. */
export async function moveStock(args: {
  partId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  qty: number;
  note?: string | null;
  actorId: string;
}) {
  requirePositive(args.qty);
  if (args.fromWarehouseId === args.toWarehouseId) {
    throw new StockError("A move needs two different warehouses");
  }
  await requireSameNetwork({
    partId: args.partId,
    warehouseIds: [args.fromWarehouseId, args.toWarehouseId],
    actorId: args.actorId,
  });

  return prisma.$transaction(async (tx) => {
    const left = await takeFromWarehouse(tx, {
      partId: args.partId,
      warehouseId: args.fromWarehouseId,
      qty: args.qty,
    });
    await addToWarehouse(tx, {
      partId: args.partId,
      warehouseId: args.toWarehouseId,
      delta: args.qty,
    });
    const movement = await writeMovement(tx, {
      partId: args.partId,
      kind: "TRANSFER",
      fromWarehouseId: args.fromWarehouseId,
      toWarehouseId: args.toWarehouseId,
      qty: args.qty,
      note: args.note,
      actorId: args.actorId,
    });
    await maybeRaiseRestock(tx, {
      partId: args.partId,
      warehouseId: args.fromWarehouseId,
      qty: left.qty,
      minQty: left.minQty,
    });
    return movement;
  });
}

/** §49 "выдача на наряд" — US-48's engineer takes the part and fits it. */
export async function issueToWorkOrder(args: {
  partId: string;
  warehouseId: string;
  qty: number;
  workOrderId: string;
  serialNo?: string | null;
  actorId: string;
}) {
  requirePositive(args.qty);

  // The order comes first: §47 scopes an engineer's right by point, and the
  // point is the order's.
  const order = await prisma.workOrder.findUnique({
    where: { id: args.workOrderId },
    select: { operatorId: true, pointId: true },
  });
  if (!order) {
    throw new StockError("That work order is not in the same network as the part");
  }

  const { part, actor } = await requireSameNetwork({
    partId: args.partId,
    warehouseIds: [args.warehouseId],
    actorId: args.actorId,
    pointId: order.pointId,
  });
  if (order.operatorId !== part.operatorId) {
    throw new StockError("That work order is not in the same network as the part");
  }

  // §49 — "наличие у себя в машине": somebody else's van is not a store this
  // engineer may take from. The owner of the network may take from any.
  if (!actor.isOwner) {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: args.warehouseId },
      select: { kind: true, keeperEmployeeId: true },
    });
    if (warehouse?.kind === "VAN" && warehouse.keeperEmployeeId !== actor.employee?.id) {
      throw new StockError("That van is somebody else's");
    }
  }

  return prisma.$transaction(async (tx) => {
    const left = await takeFromWarehouse(tx, {
      partId: args.partId,
      warehouseId: args.warehouseId,
      qty: args.qty,
    });
    const movement = await writeMovement(tx, {
      partId: args.partId,
      kind: "ISSUE",
      fromWarehouseId: args.warehouseId,
      qty: args.qty,
      workOrderId: args.workOrderId,
      serialNo: args.serialNo,
      // §49 — "стоимость запчастей автоматически попадает … в себестоимость
      // обслуживания пункта": the price rides on the movement, so a later
      // change to the part's price cannot rewrite a closed job.
      unitCostFiat: part.unitCostFiat,
      actorId: args.actorId,
    });
    await maybeRaiseRestock(tx, {
      partId: args.partId,
      warehouseId: args.warehouseId,
      qty: left.qty,
      minQty: left.minQty,
    });
    return movement;
  });
}

/** §49 "списание" — a part that is gone, with the reason it went. */
export async function writeOffStock(args: {
  partId: string;
  warehouseId: string;
  qty: number;
  note: string;
  actorId: string;
}) {
  requirePositive(args.qty);
  if (!args.note?.trim()) {
    throw new StockError("Say why it is being written off: stock that vanishes without a reason is a hole");
  }
  const { part } = await requireSameNetwork({
    partId: args.partId,
    warehouseIds: [args.warehouseId],
    actorId: args.actorId,
  });

  return prisma.$transaction(async (tx) => {
    const left = await takeFromWarehouse(tx, {
      partId: args.partId,
      warehouseId: args.warehouseId,
      qty: args.qty,
    });
    const movement = await writeMovement(tx, {
      partId: args.partId,
      kind: "WRITE_OFF",
      fromWarehouseId: args.warehouseId,
      qty: args.qty,
      unitCostFiat: part.unitCostFiat,
      note: args.note,
      actorId: args.actorId,
    });
    await maybeRaiseRestock(tx, {
      partId: args.partId,
      warehouseId: args.warehouseId,
      qty: left.qty,
      minQty: left.minQty,
    });
    return movement;
  });
}

/** §49 "возврат неисправной детали" — back on the shelf, marked faulty. */
export async function returnFaulty(args: {
  partId: string;
  warehouseId: string;
  qty: number;
  serialNo?: string | null;
  note?: string | null;
  actorId: string;
}) {
  requirePositive(args.qty);
  await requireSameNetwork({
    partId: args.partId,
    warehouseIds: [args.warehouseId],
    actorId: args.actorId,
  });

  return prisma.$transaction(async (tx) => {
    await addToWarehouse(tx, {
      partId: args.partId,
      warehouseId: args.warehouseId,
      delta: args.qty,
    });
    return writeMovement(tx, {
      partId: args.partId,
      kind: "RETURN_FAULTY",
      toWarehouseId: args.warehouseId,
      qty: args.qty,
      serialNo: args.serialNo,
      note: args.note,
      actorId: args.actorId,
    });
  });
}

/**
 * §49 "инвентаризация" — what was actually counted on the shelf.
 *
 * Recorded as the difference, not as a new level: the sum of the movements has
 * to keep equalling the level, or the reconciliation of §16.11 is measuring
 * nothing. A count that matches writes no movement at all.
 */
export async function recordStocktake(args: {
  partId: string;
  warehouseId: string;
  countedQty: number;
  note?: string | null;
  actorId: string;
}) {
  if (!Number.isInteger(args.countedQty) || args.countedQty < 0) {
    throw new StockError("A count is a whole number, and cannot be negative");
  }
  await requireSameNetwork({
    partId: args.partId,
    warehouseIds: [args.warehouseId],
    actorId: args.actorId,
  });

  return prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.upsert({
      where: { warehouseId_partId: { warehouseId: args.warehouseId, partId: args.partId } },
      update: {},
      create: { warehouseId: args.warehouseId, partId: args.partId, qty: 0 },
    });

    const delta = args.countedQty - item.qty;
    if (delta === 0) return null;

    await tx.stockItem.update({
      where: { id: item.id },
      data: { qty: args.countedQty },
    });
    const movement = await writeMovement(tx, {
      partId: args.partId,
      kind: "STOCKTAKE",
      // A surplus arrives, a shortfall leaves: either way the movement's own
      // sign is what keeps the arithmetic honest.
      toWarehouseId: delta > 0 ? args.warehouseId : null,
      fromWarehouseId: delta < 0 ? args.warehouseId : null,
      qty: delta,
      note: args.note,
      actorId: args.actorId,
    });
    await maybeRaiseRestock(tx, {
      partId: args.partId,
      warehouseId: args.warehouseId,
      qty: args.countedQty,
      minQty: item.minQty,
    });
    return movement;
  });
}

/** §49 "минимальный остаток" — and the request it raises straight away. */
export async function setMinQty(args: {
  partId: string;
  warehouseId: string;
  minQty: number;
  actorId: string;
}) {
  if (!Number.isInteger(args.minQty) || args.minQty < 0) {
    throw new StockError("A minimum is a whole number, and cannot be negative");
  }
  await requireSameNetwork({
    partId: args.partId,
    warehouseIds: [args.warehouseId],
    actorId: args.actorId,
  });

  return prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.upsert({
      where: { warehouseId_partId: { warehouseId: args.warehouseId, partId: args.partId } },
      update: { minQty: args.minQty },
      create: { warehouseId: args.warehouseId, partId: args.partId, qty: 0, minQty: args.minQty },
    });
    // Setting a minimum above what is there is itself the moment the level is
    // "below minimum" — the keeper should hear about it now, not at the next
    // issue.
    await maybeRaiseRestock(tx, {
      partId: args.partId,
      warehouseId: args.warehouseId,
      qty: item.qty,
      minQty: args.minQty,
    });
    return item;
  });
}

export async function closeRestockRequest(args: {
  requestId: string;
  actorId: string;
  status?: "ORDERED" | "CLOSED";
  note?: string | null;
}) {
  const request = await prisma.restockRequest.findUnique({
    where: { id: args.requestId },
    include: { warehouse: { select: { operatorId: true } } },
  });
  if (!request) throw new StockError("No such request");
  await requireNetwork(request.warehouse.operatorId, args.actorId);

  return prisma.restockRequest.update({
    where: { id: request.id },
    data: {
      status: args.status ?? "CLOSED",
      closedAt: new Date(),
      closedById: args.actorId,
      note: args.note?.trim() || request.note,
    },
  });
}

export interface StockRow {
  warehouseId: string;
  warehouseName: string;
  warehouseKind: string;
  partId: string;
  partName: string;
  sku: string;
  qty: number;
  minQty: number;
  /** §49's "минимальный остаток" crossed — the keeper's own red flag. */
  below: boolean;
  unitCostFiat: number | null;
  currency: string;
}

export interface StockView {
  warehouses: { id: string; name: string; kind: string; city: string | null }[];
  items: StockRow[];
  openRequests: {
    id: string;
    warehouseId: string;
    warehouseName: string;
    partId: string;
    partName: string;
    sku: string;
    qtyAtRequest: number;
    minQty: number;
    suggestedQty: number;
    createdAt: Date;
    notifiedAt: Date | null;
  }[];
}

/** §49 "Остатки в реальном времени" — the whole network's shelves. */
export async function readStock(operatorId: string, userId: string): Promise<StockView> {
  await requireNetwork(operatorId, userId);

  const [warehouses, items, requests] = await Promise.all([
    prisma.warehouse.findMany({
      where: { operatorId },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
    prisma.stockItem.findMany({
      where: { part: { operatorId } },
      include: {
        part: true,
        warehouse: { select: { id: true, name: true, kind: true } },
      },
      orderBy: [{ warehouse: { name: "asc" } }, { part: { name: "asc" } }],
    }),
    prisma.restockRequest.findMany({
      where: { warehouse: { operatorId }, status: "OPEN" },
      orderBy: { createdAt: "asc" },
      include: { warehouse: { select: { name: true } } },
    }),
  ]);

  const parts = new Map(
    (await prisma.sparePart.findMany({ where: { operatorId } })).map((p) => [p.id, p]),
  );

  return {
    warehouses: warehouses.map((w) => ({
      id: w.id,
      name: w.name,
      kind: w.kind,
      city: w.city,
    })),
    items: items.map((i) => ({
      warehouseId: i.warehouseId,
      warehouseName: i.warehouse.name,
      warehouseKind: i.warehouse.kind,
      partId: i.partId,
      partName: i.part.name,
      sku: i.part.sku,
      qty: i.qty,
      minQty: i.minQty,
      below: i.minQty > 0 && i.qty < i.minQty,
      unitCostFiat: i.part.unitCostFiat == null ? null : Number(i.part.unitCostFiat),
      currency: i.part.currency,
    })),
    openRequests: requests.map((r) => {
      const part = parts.get(r.partId);
      return {
        id: r.id,
        warehouseId: r.warehouseId,
        warehouseName: r.warehouse.name,
        partId: r.partId,
        partName: part?.name ?? r.partId,
        sku: part?.sku ?? "—",
        qtyAtRequest: r.qtyAtRequest,
        minQty: r.minQty,
        suggestedQty: r.suggestedQty,
        createdAt: r.createdAt,
        notifiedAt: r.notifiedAt,
      };
    }),
  };
}

export type { Db };
