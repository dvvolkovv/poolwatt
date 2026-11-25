"use server";

// §49's operations, from the keeper's page.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  StockError,
  closeRestockRequest,
  moveStock,
  receiveStock,
  recordStocktake,
  returnFaulty,
  setMinQty,
  writeOffStock,
} from "@/lib/warehouse/stock-service";

export type ActionResult = { ok: true } | { ok: false; formError: string };

function refresh() {
  revalidatePath("/[locale]/me/charger-operator/[id]/warehouse", "page");
}

async function run(fn: (userId: string) => Promise<unknown>): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  try {
    await fn(session.user.id);
    refresh();
    return { ok: true };
  } catch (err) {
    if (err instanceof StockError) return { ok: false, formError: err.message };
    return { ok: false, formError: err instanceof Error ? err.message : "Could not do that." };
  }
}

/** Only the person who claimed the network may change its stores. */
async function assertOwner(operatorId: string, userId: string): Promise<void> {
  const op = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { claimedById: true },
  });
  if (!op || op.claimedById !== userId) throw new StockError("This network belongs to somebody else");
}

const partSchema = z.object({
  operatorId: z.string().min(1),
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(160),
  manufacturer: z.string().trim().max(80).nullable(),
  compatibleModels: z.array(z.string().trim().max(80)).max(30),
  unitCostFiat: z.number().min(0).max(1_000_000).nullable(),
  currency: z.string().length(3),
  serialTracked: z.boolean(),
});

export async function savePartAction(input: unknown): Promise<ActionResult> {
  const parsed = partSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { operatorId, sku, ...rest } = parsed.data;

  return run(async (userId) => {
    await assertOwner(operatorId, userId);
    return prisma.sparePart.upsert({
      where: { operatorId_sku: { operatorId, sku } },
      update: rest,
      create: { operatorId, sku, ...rest },
    });
  });
}

const warehouseSchema = z.object({
  operatorId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  kind: z.enum(["CENTRAL", "REGIONAL", "VAN"]),
  city: z.string().trim().max(80).nullable(),
  keeperEmployeeId: z.string().min(1).nullable(),
});

export async function saveWarehouseAction(input: unknown): Promise<ActionResult> {
  const parsed = warehouseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { operatorId, name, ...rest } = parsed.data;

  return run(async (userId) => {
    await assertOwner(operatorId, userId);
    if (rest.keeperEmployeeId) {
      const employee = await prisma.employee.findUnique({
        where: { id: rest.keeperEmployeeId },
        select: { operatorId: true },
      });
      if (!employee || employee.operatorId !== operatorId) {
        throw new StockError("That person is not an employee of this network");
      }
    }
    return prisma.warehouse.upsert({
      where: { operatorId_name: { operatorId, name } },
      update: rest,
      create: { operatorId, name, ...rest },
    });
  });
}

const movementSchema = z.object({
  partId: z.string().min(1),
  warehouseId: z.string().min(1),
  qty: z.number().int().positive().max(1_000_000),
  note: z.string().trim().max(300).nullable(),
});

export async function receiveAction(input: unknown): Promise<ActionResult> {
  const parsed = movementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return run((userId) => receiveStock({ ...parsed.data, actorId: userId }));
}

export async function writeOffAction(input: unknown): Promise<ActionResult> {
  const parsed = movementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return run((userId) =>
    writeOffStock({ ...parsed.data, note: parsed.data.note ?? "", actorId: userId }),
  );
}

export async function returnFaultyAction(input: unknown): Promise<ActionResult> {
  const parsed = movementSchema.extend({ serialNo: z.string().trim().max(80).nullable() }).safeParse(
    input,
  );
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return run((userId) => returnFaulty({ ...parsed.data, actorId: userId }));
}

export async function moveAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      partId: z.string().min(1),
      fromWarehouseId: z.string().min(1),
      toWarehouseId: z.string().min(1),
      qty: z.number().int().positive().max(1_000_000),
      note: z.string().trim().max(300).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return run((userId) => moveStock({ ...parsed.data, actorId: userId }));
}

export async function stocktakeAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      partId: z.string().min(1),
      warehouseId: z.string().min(1),
      countedQty: z.number().int().min(0).max(1_000_000),
      note: z.string().trim().max(300).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return run((userId) => recordStocktake({ ...parsed.data, actorId: userId }));
}

export async function setMinQtyAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      partId: z.string().min(1),
      warehouseId: z.string().min(1),
      minQty: z.number().int().min(0).max(1_000_000),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return run((userId) => setMinQty({ ...parsed.data, actorId: userId }));
}

export async function closeRequestAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      requestId: z.string().min(1),
      status: z.enum(["ORDERED", "CLOSED"]),
      note: z.string().trim().max(300).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return run((userId) => closeRestockRequest({ ...parsed.data, actorId: userId }));
}
