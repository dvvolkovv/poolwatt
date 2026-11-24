// Idempotency for every POST that moves money or energy — ТЗ §15
// ("Все POST-запросы с ключом идемпотентности").
//
// A client that loses the answer to a payment must be able to ask again
// without paying twice. So the first request of a (endpoint, caller, key)
// triple claims the row, runs the handler and stores the response; every
// later request with the same body gets that response back verbatim.
//
// Three cases the unique index decides for us, without a lock:
//   * same key, same body, finished   → replay the stored response;
//   * same key, different body        → 409, the key was reused by mistake;
//   * same key, still running         → 409, the client should wait and ask
//                                       again rather than start a second
//                                       transfer of the same money.
//
// Failures are not stored: a charge that ran out of balance may legitimately
// be retried with the same key once the balance is topped up.

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** A stub left behind by a crashed process is claimed again after this. */
export const IN_FLIGHT_TAKEOVER_MS = 60_000;

/** §17 keeps financial records for five years; this is only a replay log. */
export const IDEMPOTENCY_RETENTION_DAYS = 30;

export class IdempotencyKeyRequiredError extends Error {
  constructor() {
    super("Idempotency-Key header is required (ТЗ §15)");
  }
}

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Hash of the request body, insensitive to key order but not to types: a
 * client that re-sends the same intent must hash the same, a client that
 * changed the amount must not.
 */
export function canonicalHash(body: unknown): string {
  return createHash("sha256").update(canonicalize(body)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(",")}}`;
  }
  // The type is part of the hash: 1 and "1" are different requests.
  return `${typeof value}:${JSON.stringify(value)}`;
}

export interface IdempotentResult<T> {
  status: number;
  data: T;
  /** True when the response came from the store rather than the handler. */
  replayed: boolean;
}

export interface IdempotentArgs<T extends Record<string, unknown>> {
  /** Stable name of the operation, e.g. "POST /v1/orders". */
  endpoint: string;
  /** The Idempotency-Key header, or null when the client omitted it. */
  key: string | null;
  /** User id for session endpoints, api key id for equipment. */
  userKey: string;
  body: unknown;
  run: () => Promise<{ status: number; data: T }>;
}

export async function runIdempotent<T extends Record<string, unknown>>(
  args: IdempotentArgs<T>,
): Promise<IdempotentResult<T>> {
  const key = args.key?.trim();
  if (!key) throw new IdempotencyKeyRequiredError();

  const where = { endpoint: args.endpoint, userKey: args.userKey, key } as const;
  const requestHash = canonicalHash(args.body);

  const existing = await prisma.idempotencyRecord.findUnique({
    where: { endpoint_userKey_key: where },
  });
  const claimed = existing
    ? decide(existing, requestHash)
    : await claim(where, requestHash);

  if (claimed.kind === "replay") {
    return { status: claimed.status, data: claimed.response as T, replayed: true };
  }

  let outcome: { status: number; data: T };
  try {
    outcome = await args.run();
  } catch (err) {
    // Release the claim so the client may retry with the same key.
    await prisma.idempotencyRecord
      .delete({ where: { id: claimed.id } })
      .catch(() => undefined);
    throw err;
  }

  await prisma.idempotencyRecord.update({
    where: { id: claimed.id },
    data: {
      status: outcome.status,
      response: outcome.data as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });

  return { ...outcome, replayed: false };
}

type Claim =
  | { kind: "run"; id: string }
  | { kind: "replay"; status: number; response: unknown };

interface RecordRow {
  id: string;
  status: number;
  response: unknown;
  requestHash: string;
  createdAt: Date;
}

function decide(row: RecordRow, requestHash: string): Claim {
  if (row.requestHash !== requestHash) {
    throw new IdempotencyConflictError(
      "This Idempotency-Key was already used with a different request body",
    );
  }
  if (row.status > 0) {
    return { kind: "replay", status: row.status, response: row.response };
  }
  // status 0 — someone else is running it right now, or died trying.
  if (Date.now() - row.createdAt.getTime() < IN_FLIGHT_TAKEOVER_MS) {
    throw new IdempotencyConflictError(
      "A request with this Idempotency-Key is still in flight",
    );
  }
  return { kind: "run", id: row.id };
}

async function claim(
  where: { endpoint: string; userKey: string; key: string },
  requestHash: string,
): Promise<Claim> {
  try {
    const row = await prisma.idempotencyRecord.create({
      data: { ...where, requestHash, status: 0 },
    });
    return { kind: "run", id: row.id };
  } catch (err) {
    // Two concurrent first requests: the loser re-reads and obeys the winner.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const row = await prisma.idempotencyRecord.findUnique({
        where: { endpoint_userKey_key: where },
      });
      if (row) return decide(row, requestHash);
    }
    throw err;
  }
}

/** Drop the replay log older than the retention window (worker, daily). */
export async function purgeIdempotencyRecords(
  days = IDEMPOTENCY_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.idempotencyRecord.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
