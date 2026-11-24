// ТЗ §15 — "Все POST-запросы с ключом идемпотентности".
//
// The guard is a table, so these are integration tests against the throwaway
// database (see CLAUDE.md for the DATABASE_URL override).

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  IdempotencyConflictError,
  IdempotencyKeyRequiredError,
  IN_FLIGHT_TAKEOVER_MS,
  canonicalHash,
  purgeIdempotencyRecords,
  runIdempotent,
} from "./idempotency";

const ENDPOINT = "POST /v1/test-idem";
const CALLER = "test_idem_user";
const OTHER_CALLER = "test_idem_user_2";

async function wipe() {
  await prisma.idempotencyRecord.deleteMany({
    where: { userKey: { in: [CALLER, OTHER_CALLER] } },
  });
}

beforeEach(wipe);
afterAll(wipe);

describe("canonicalHash", () => {
  it("ignores key order", () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it("changes when a value changes", () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });

  it("distinguishes a number from its string", () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: "1" }));
  });

  it("walks nested objects and arrays", () => {
    expect(canonicalHash({ a: [{ x: 1, y: 2 }] })).toBe(canonicalHash({ a: [{ y: 2, x: 1 }] }));
    expect(canonicalHash({ a: [1, 2] })).not.toBe(canonicalHash({ a: [2, 1] }));
  });
});

describe("runIdempotent", () => {
  it("refuses a request without a key", async () => {
    await expect(
      runIdempotent({
        endpoint: ENDPOINT,
        key: null,
        userKey: CALLER,
        body: { v: 1 },
        run: async () => ({ status: 201, data: { ok: 1 } }),
      }),
    ).rejects.toBeInstanceOf(IdempotencyKeyRequiredError);
  });

  it("runs the handler once and stores its response", async () => {
    const result = await runIdempotent({
      endpoint: ENDPOINT,
      key: "k1",
      userKey: CALLER,
      body: { v: 1 },
      run: async () => ({ status: 201, data: { orderId: "o1" } }),
    });
    expect(result).toEqual({ status: 201, data: { orderId: "o1" }, replayed: false });

    const stored = await prisma.idempotencyRecord.findFirst({
      where: { endpoint: ENDPOINT, userKey: CALLER, key: "k1" },
    });
    expect(stored?.status).toBe(201);
    expect(stored?.response).toEqual({ orderId: "o1" });
  });

  it("replays the stored response instead of running again", async () => {
    let calls = 0;
    const run = async () => {
      calls += 1;
      return { status: 201, data: { orderId: `o${calls}` } };
    };
    const args = { endpoint: ENDPOINT, key: "k2", userKey: CALLER, body: { v: 7 }, run };

    const first = await runIdempotent(args);
    const second = await runIdempotent(args);

    expect(calls).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.data).toEqual({ orderId: "o1" });
    expect(second.status).toBe(201);
  });

  it("rejects the same key with a different body", async () => {
    const base = {
      endpoint: ENDPOINT,
      key: "k3",
      userKey: CALLER,
      run: async () => ({ status: 201, data: { ok: true } }),
    };
    await runIdempotent({ ...base, body: { amountKwh: 10 } });

    await expect(runIdempotent({ ...base, body: { amountKwh: 999 } })).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
  });

  it("scopes keys to the caller", async () => {
    let calls = 0;
    const run = async () => {
      calls += 1;
      return { status: 201, data: { n: calls } };
    };
    await runIdempotent({ endpoint: ENDPOINT, key: "shared", userKey: CALLER, body: {}, run });
    const other = await runIdempotent({
      endpoint: ENDPOINT,
      key: "shared",
      userKey: OTHER_CALLER,
      body: {},
      run,
    });
    expect(calls).toBe(2);
    expect(other.replayed).toBe(false);
  });

  it("lets only one of two concurrent requests through", async () => {
    let calls = 0;
    const run = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 120));
      return { status: 201, data: { n: calls } };
    };
    const args = { endpoint: ENDPOINT, key: "race", userKey: CALLER, body: { v: 1 }, run };

    const settled = await Promise.allSettled([runIdempotent(args), runIdempotent(args)]);
    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");

    expect(calls).toBe(1);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(IdempotencyConflictError);
  });

  it("takes over a stub abandoned by a crashed process", async () => {
    await prisma.idempotencyRecord.create({
      data: {
        endpoint: ENDPOINT,
        key: "stale",
        userKey: CALLER,
        requestHash: canonicalHash({ v: 1 }),
        status: 0,
        response: {},
        createdAt: new Date(Date.now() - IN_FLIGHT_TAKEOVER_MS - 1000),
      },
    });

    const result = await runIdempotent({
      endpoint: ENDPOINT,
      key: "stale",
      userKey: CALLER,
      body: { v: 1 },
      run: async () => ({ status: 201, data: { retried: true } }),
    });
    expect(result.data).toEqual({ retried: true });
    expect(result.replayed).toBe(false);
  });

  it("does not cache a failure, so the client may retry", async () => {
    const args = {
      endpoint: ENDPOINT,
      key: "boom",
      userKey: CALLER,
      body: { v: 1 },
    };
    await expect(
      runIdempotent({
        ...args,
        run: async () => {
          throw new Error("insufficient balance");
        },
      }),
    ).rejects.toThrow("insufficient balance");

    expect(
      await prisma.idempotencyRecord.count({
        where: { endpoint: ENDPOINT, userKey: CALLER, key: "boom" },
      }),
    ).toBe(0);

    const retried = await runIdempotent({
      ...args,
      run: async () => ({ status: 201, data: { ok: true } }),
    });
    expect(retried.data).toEqual({ ok: true });
  });
});

describe("purgeIdempotencyRecords", () => {
  it("removes records older than the retention window and keeps fresh ones", async () => {
    await prisma.idempotencyRecord.createMany({
      data: [
        {
          endpoint: ENDPOINT,
          key: "old",
          userKey: CALLER,
          requestHash: "h",
          status: 201,
          response: {},
          createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        },
        {
          endpoint: ENDPOINT,
          key: "new",
          userKey: CALLER,
          requestHash: "h",
          status: 201,
          response: {},
        },
      ],
    });

    const removed = await purgeIdempotencyRecords(30);
    expect(removed).toBe(1);
    const left = await prisma.idempotencyRecord.findMany({ where: { userKey: CALLER } });
    expect(left.map((r) => r.key)).toEqual(["new"]);
  });
});
