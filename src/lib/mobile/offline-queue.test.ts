// §48 — «Офлайн-режим: наряд закрывается без связи и синхронизируется
// позже». The queue is pure: storage and the sender are injected, so the
// tests need no browser.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUEUE_KEY,
  type QueuedOp,
  type SendResult,
  enqueue,
  flush,
  forget,
  list,
  listFor,
  pendingCount,
} from "./offline-queue";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

let storage: Storage;

const issueOp = {
  kind: "stock.issue" as const,
  body: { kind: "ISSUE", partId: "p1", warehouseId: "w1", qty: 1, workOrderId: "o1" },
  workOrderId: "o1",
  label: "CCS2 cable, 5 m × 1",
};

beforeEach(() => {
  storage = memoryStorage();
});

describe("enqueue", () => {
  it("gives each operation its own idempotency key and keeps the order", () => {
    const a = enqueue(storage, issueOp);
    const b = enqueue(storage, issueOp);

    expect(a.id).not.toBe(b.id);
    expect(list(storage).map((op) => op.id)).toEqual([a.id, b.id]);
    expect(a.state).toBe("pending");
  });

  it("survives junk in the storage slot", () => {
    storage.setItem(QUEUE_KEY, "{not json");
    expect(list(storage)).toEqual([]);
    expect(enqueue(storage, issueOp).state).toBe("pending");
    expect(list(storage)).toHaveLength(1);
  });
});

describe("flush", () => {
  it("sends each pending operation under its own key and drops what went through", async () => {
    const a = enqueue(storage, issueOp);
    const b = enqueue(storage, issueOp);
    const seen: QueuedOp[] = [];
    const send = vi.fn(async (op: QueuedOp): Promise<SendResult> => {
      seen.push(op);
      return { outcome: "done" };
    });

    const report = await flush(storage, send);

    expect(report).toEqual({ sent: 2, pending: 0, rejected: 0 });
    expect(seen.map((op) => op.id)).toEqual([a.id, b.id]);
    expect(list(storage)).toEqual([]);
  });

  it("keeps the same key across a retry", async () => {
    const a = enqueue(storage, issueOp);
    const keys: string[] = [];
    const flaky = async (op: QueuedOp): Promise<SendResult> => {
      keys.push(op.id);
      return keys.length === 1 ? { outcome: "offline" } : { outcome: "done" };
    };

    await flush(storage, flaky);
    expect(list(storage)).toHaveLength(1);
    await flush(storage, flaky);

    expect(keys).toEqual([a.id, a.id]);
    expect(list(storage)).toEqual([]);
  });

  it("stops at the first operation the network could not take", async () => {
    enqueue(storage, issueOp);
    enqueue(storage, issueOp);
    const send = vi.fn(async (): Promise<SendResult> => ({ outcome: "offline" }));

    const report = await flush(storage, send);

    // Порядок нажатий — порядок отправки: второе списание не должно
    // обогнать первое, иначе остаток падает в чужом порядке.
    expect(send).toHaveBeenCalledTimes(1);
    expect(report).toEqual({ sent: 0, pending: 2, rejected: 0 });
  });

  it("keeps an in-flight conflict pending", async () => {
    enqueue(storage, issueOp);
    const report = await flush(storage, async () => ({ outcome: "busy" }));
    expect(report.pending).toBe(1);
    expect(list(storage)[0].state).toBe("pending");
  });

  it("marks a refusal with the server's own words and carries on", async () => {
    enqueue(storage, issueOp);
    const good = enqueue(storage, issueOp);
    let call = 0;
    const send = async (): Promise<SendResult> => {
      call += 1;
      return call === 1
        ? { outcome: "rejected", reason: "Not enough on the shelf: only 0 there" }
        : { outcome: "done" };
    };

    const report = await flush(storage, send);

    expect(report).toEqual({ sent: 1, pending: 0, rejected: 1 });
    const left = list(storage);
    expect(left).toHaveLength(1);
    expect(left[0].state).toBe("rejected");
    expect(left[0].reason).toContain("only 0 there");
    expect(left[0].id).not.toBe(good.id);
  });

  it("does not try a rejected operation again", async () => {
    enqueue(storage, issueOp);
    await flush(storage, async () => ({ outcome: "rejected", reason: "no" }));
    const send = vi.fn(async (): Promise<SendResult> => ({ outcome: "done" }));

    const report = await flush(storage, send);

    expect(send).not.toHaveBeenCalled();
    expect(report).toEqual({ sent: 0, pending: 0, rejected: 1 });
  });
});

describe("forget and pendingCount", () => {
  it("lets the engineer dismiss a refusal", async () => {
    const op = enqueue(storage, issueOp);
    await flush(storage, async () => ({ outcome: "rejected", reason: "no" }));
    forget(storage, op.id);
    expect(list(storage)).toEqual([]);
  });

  it("counts only what is still waiting to go", async () => {
    enqueue(storage, issueOp);
    enqueue(storage, issueOp);
    let call = 0;
    await flush(storage, async (): Promise<SendResult> => {
      call += 1;
      return call === 1 ? { outcome: "rejected", reason: "no" } : { outcome: "offline" };
    });
    expect(pendingCount(storage)).toBe(1);
    expect(list(storage)).toHaveLength(2);
  });
});

describe("classify — a real fetch answer in the queue's own terms", () => {
  const answer = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { "content-type": "application/json" },
    });

  it("calls 2xx done, replay included", async () => {
    const { classify } = await import("./offline-queue");
    expect(await classify(answer(201, { ok: true }))).toEqual({ outcome: "done" });
  });

  it("calls 409 busy — the answer is coming, just not now", async () => {
    const { classify } = await import("./offline-queue");
    expect(await classify(answer(409, { ok: false, error: "in flight" }))).toEqual({
      outcome: "busy",
    });
  });

  it("calls 5xx offline — theirs to fix, ours to retry", async () => {
    const { classify } = await import("./offline-queue");
    expect(await classify(answer(503))).toEqual({ outcome: "offline" });
  });

  it("carries a 4xx refusal through in the server's own words", async () => {
    const { classify } = await import("./offline-queue");
    expect(
      await classify(answer(400, { ok: false, error: "Not enough on the shelf: only 2 there" })),
    ).toEqual({ outcome: "rejected", reason: "Not enough on the shelf: only 2 there" });
  });

  it("falls back to the status code when the body is not JSON", async () => {
    const { classify } = await import("./offline-queue");
    expect(await classify(new Response("nope", { status: 404 }))).toEqual({
      outcome: "rejected",
      reason: "HTTP 404",
    });
  });
});

// §48 — пятый вид записи: слово в чат наряда из подвала.
describe("сообщение чата в очереди", () => {
  it("встаёт в очередь своего наряда и несёт свой ключ", () => {
    const op = enqueue(storage, {
      kind: "workorder.chat",
      body: { body: "ворота с обратной стороны" },
      workOrderId: "w1",
      label: "ворота с обратной стороны",
    });

    expect(op.id).toBeTruthy();
    expect(listFor(storage, "w1").map((o) => o.kind)).toEqual(["workorder.chat"]);
    expect(listFor(storage, "w2")).toEqual([]);
  });

  it("досылается один раз: ключ придуман при нажатии", async () => {
    enqueue(storage, {
      kind: "workorder.chat",
      body: { body: "уже на месте" },
      workOrderId: "w1",
      label: "уже на месте",
    });

    const keys: string[] = [];
    await flush(storage, async (op) => {
      keys.push(op.id);
      return { outcome: "offline" };
    });
    await flush(storage, async (op) => {
      keys.push(op.id);
      return { outcome: "done" };
    });

    expect(keys[0]).toBe(keys[1]);
    expect(list(storage)).toEqual([]);
  });
});
