// Shared plumbing for the /v1 REST surface described in ТЗ §15.
//
// Conventions kept uniform across every route so partner integrations see one
// contract: `{ ok: true, ... }` or `{ ok: false, error, issues? }`, OAuth
// session auth for user endpoints, Bearer asset keys for equipment, and an
// `Idempotency-Key` header on every POST that moves energy or money.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { auth } from "@/lib/auth";
import { FeatureClosedError } from "./gates";

export function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function fail(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export const unauthorized = (msg = "Authentication required") => fail(msg, 401);
export const forbidden = (msg = "Not allowed") => fail(msg, 403);
export const notFound = (msg = "Not found") => fail(msg, 404);

export interface SessionUser {
  id: string;
  username: string;
  role: "USER" | "ADMIN";
}

/** OAuth/session-authenticated caller, or null. */
export async function sessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    username: session.user.username,
    role: session.user.role,
  };
}

/** §15 — the operator-only endpoints (listing decisions, zone parameters). */
export async function operatorUser(): Promise<SessionUser | null> {
  const user = await sessionUser();
  return user?.role === "ADMIN" ? user : null;
}

/** Bearer token from the Authorization header, for equipment API keys. */
export function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

/** §15 — "Все POST-запросы с ключом идемпотентности". */
export function idempotencyKey(req: NextRequest): string | null {
  const key = req.headers.get("idempotency-key");
  return key && key.trim().length > 0 ? key.trim().slice(0, 190) : null;
}

export type Parsed<T> = { data: T } | { response: NextResponse };

/** Parse and validate a JSON body, returning a ready response on failure. */
export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { response: fail("Body must be JSON", 400) };
  }
  try {
    return { data: schema.parse(raw) };
  } catch (err) {
    if (err instanceof ZodError) {
      return { response: fail("Invalid body", 422, { issues: err.issues }) };
    }
    throw err;
  }
}

/** Map a domain error onto an HTTP response without leaking internals. */
export function domainError(err: unknown): NextResponse {
  if (err instanceof FeatureClosedError) return fail(err.message, 503);
  const message = err instanceof Error ? err.message : String(err);
  const notFoundish = /not found|no .* named|Unknown grid zone/i.test(message);
  return fail(message.slice(0, 400), notFoundish ? 404 : 400);
}
