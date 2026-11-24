// Live channels — ТЗ §15 ("WebSocket-каналы: orderbook.{zone},
// trades.{zone}, wallet.{user}, telemetry.{asset}") and US-17, which asks for
// a balance that updates by itself.
//
// Three parts, deliberately small:
//   * channel names, so publisher and subscriber cannot drift apart;
//   * tickets, because a browser cannot put an Authorization header on a
//     WebSocket — the page asks the signed-in app for a short-lived ticket
//     listing the channels it may hear, and the socket presents that;
//   * publish(), a one-way push onto the Redis bus that the standalone
//     realtime process fans out from.
//
// Publishing never fails a transaction: a lost tick costs a page refresh, a
// thrown error would cost a payment.

import { createHmac, timingSafeEqual } from "node:crypto";
import { redis } from "@/lib/redis";

/** Redis key space for the bus, so other Redis users are unaffected. */
export const CHANNEL_PREFIX = "poolwatt:rt:";

/** A ticket is a handshake, not a session: one minute is plenty. */
export const TICKET_TTL_SECONDS = 60;

export const orderbookChannel = (zoneCode: string) => `orderbook.${zoneCode.toUpperCase()}`;
export const tradesChannel = (zoneCode: string) => `trades.${zoneCode.toUpperCase()}`;
export const walletChannel = (userId: string) => `wallet.${userId}`;
export const telemetryChannel = (assetId: string) => `telemetry.${assetId}`;

/** §15 channel names, as a guard against typos in a publisher. */
export function isKnownChannel(channel: string): boolean {
  return /^(orderbook|trades|wallet|telemetry)\.[A-Za-z0-9_-]{1,64}$/.test(channel);
}

/** Order books and trades are public: the terminal shows them to anyone. */
export function isPublicChannel(channel: string): boolean {
  return channel.startsWith("orderbook.") || channel.startsWith("trades.");
}

export interface RealtimeEvent {
  channel: string;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

function ticketSecret(): string {
  // AUTH_SECRET is the Auth.js v5 name and the one this deployment sets;
  // NEXTAUTH_SECRET is kept as the v4 fallback. Both processes must agree, or
  // every ticket is refused — see CLAUDE.md on stale PM2 environments.
  const secret =
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || "";
  if (!secret) {
    throw new Error("AUTH_SECRET (or NEXTAUTH_SECRET) is required to sign realtime tickets");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", ticketSecret()).update(payload).digest("hex");
}

export interface TicketClaims {
  /** Null for an anonymous viewer of the public channels. */
  userId: string | null;
  channels: string[];
  expiresAt: number;
}

export function issueTicket(args: {
  userId: string | null;
  channels: string[];
  now?: Date;
}): string {
  const expiresAt =
    Math.floor((args.now ?? new Date()).getTime() / 1000) + TICKET_TTL_SECONDS;
  const claims = {
    u: args.userId,
    c: args.channels.filter(isKnownChannel),
    e: expiresAt,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyTicket(ticket: string, now = new Date()): TicketClaims | null {
  const dot = ticket.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = ticket.slice(0, dot);
  const presented = ticket.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(presented)) return null;

  const expected = sign(payload);
  if (!timingSafeEqual(Buffer.from(presented, "hex"), Buffer.from(expected, "hex"))) {
    return null;
  }

  let claims: { u?: unknown; c?: unknown; e?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const expiresAt = Number(claims.e);
  if (!Number.isFinite(expiresAt)) return null;
  if (expiresAt * 1000 <= now.getTime()) return null;

  return {
    userId: typeof claims.u === "string" ? claims.u : null,
    channels: Array.isArray(claims.c) ? claims.c.filter((c): c is string => typeof c === "string") : [],
    expiresAt,
  };
}

/** What a socket presenting this ticket may hear. */
export function ticketAllows(claims: TicketClaims, channel: string): boolean {
  return claims.channels.includes(channel);
}

type Publisher = { publish(channel: string, message: string): Promise<unknown> };

/**
 * Push one event. Returns true when it reached the bus — callers ignore it;
 * the return value exists so tests can tell silence from success.
 */
export async function publish(
  channel: string,
  type: string,
  data: Record<string, unknown>,
  client: Publisher = redis,
): Promise<boolean> {
  if (!isKnownChannel(channel)) return false;
  const event: RealtimeEvent = { channel, type, at: new Date().toISOString(), data };
  try {
    await client.publish(`${CHANNEL_PREFIX}${channel}`, JSON.stringify(event));
    return true;
  } catch {
    // A page that misses a tick still shows correct data on its next load.
    return false;
  }
}
