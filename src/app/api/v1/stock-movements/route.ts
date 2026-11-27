// POST /v1/stock-movements — ТЗ §50, §49's six operations.
//
// This is the method an engineer's app calls when it takes a part off the van
// and fits it: §49 asks for the issue to happen "по факту", on the job, not
// later at a desk.
//
// Under §15's key, because US-49 lets the phone keep the movement until the
// signal is back. A re-send is the normal case there, not a mishap, and a
// movement puts a part's cost into the point's upkeep (§49) — so a second
// write would be a second charge.

import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  fail,
  idempotencyKey,
  idempotent,
  parseBody,
  sessionUser,
  unauthorized,
} from "@/lib/exchange/api";
import {
  StockError,
  issueToWorkOrder,
  moveStock,
  receiveStock,
  recordStocktake,
  returnFaulty,
  writeOffStock,
} from "@/lib/warehouse/stock-service";

const bodySchema = z.object({
  kind: z.enum(["RECEIPT", "TRANSFER", "ISSUE", "WRITE_OFF", "RETURN_FAULTY", "STOCKTAKE"]),
  partId: z.string().min(1),
  warehouseId: z.string().min(1).optional(),
  fromWarehouseId: z.string().min(1).optional(),
  toWarehouseId: z.string().min(1).optional(),
  qty: z.number().int().positive().max(1_000_000).optional(),
  countedQty: z.number().int().min(0).max(1_000_000).optional(),
  workOrderId: z.string().min(1).optional(),
  serialNo: z.string().max(80).optional().nullable(),
  note: z.string().max(300).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;
  const b = parsed.data;

  const need = (value: unknown, what: string): never | void => {
    if (value == null) throw new StockError(`${what} is required for a ${b.kind}`);
  };

  try {
    return await idempotent({
      endpoint: "POST /v1/stock-movements",
      key: idempotencyKey(req),
      userKey: user.id,
      body: b,
      run: async () => {
        let movementId: string | null = null;

        switch (b.kind) {
          case "RECEIPT": {
            need(b.warehouseId, "warehouseId");
            need(b.qty, "qty");
            const m = await receiveStock({
              partId: b.partId,
              warehouseId: b.warehouseId!,
              qty: b.qty!,
              note: b.note,
              actorId: user.id,
            });
            movementId = m.id;
            break;
          }
          case "TRANSFER": {
            need(b.fromWarehouseId, "fromWarehouseId");
            need(b.toWarehouseId, "toWarehouseId");
            need(b.qty, "qty");
            const m = await moveStock({
              partId: b.partId,
              fromWarehouseId: b.fromWarehouseId!,
              toWarehouseId: b.toWarehouseId!,
              qty: b.qty!,
              note: b.note,
              actorId: user.id,
            });
            movementId = m.id;
            break;
          }
          case "ISSUE": {
            need(b.warehouseId, "warehouseId");
            need(b.qty, "qty");
            need(b.workOrderId, "workOrderId");
            const m = await issueToWorkOrder({
              partId: b.partId,
              warehouseId: b.warehouseId!,
              qty: b.qty!,
              workOrderId: b.workOrderId!,
              serialNo: b.serialNo,
              actorId: user.id,
            });
            movementId = m.id;
            break;
          }
          case "WRITE_OFF": {
            need(b.warehouseId, "warehouseId");
            need(b.qty, "qty");
            const m = await writeOffStock({
              partId: b.partId,
              warehouseId: b.warehouseId!,
              qty: b.qty!,
              note: b.note ?? "",
              actorId: user.id,
            });
            movementId = m.id;
            break;
          }
          case "RETURN_FAULTY": {
            need(b.warehouseId, "warehouseId");
            need(b.qty, "qty");
            const m = await returnFaulty({
              partId: b.partId,
              warehouseId: b.warehouseId!,
              qty: b.qty!,
              serialNo: b.serialNo,
              note: b.note,
              actorId: user.id,
            });
            movementId = m.id;
            break;
          }
          case "STOCKTAKE": {
            need(b.warehouseId, "warehouseId");
            need(b.countedQty, "countedQty");
            const m = await recordStocktake({
              partId: b.partId,
              warehouseId: b.warehouseId!,
              countedQty: b.countedQty!,
              note: b.note,
              actorId: user.id,
            });
            // A count that matched writes no movement, and that is not an error.
            movementId = m?.id ?? null;
            break;
          }
        }

        return { status: 201, data: { movement: { id: movementId, kind: b.kind } } };
      },
    });
  } catch (err) {
    if (err instanceof StockError) {
      return fail(err.message, /somebody else|No such/.test(err.message) ? 404 : 400);
    }
    throw err;
  }
}
