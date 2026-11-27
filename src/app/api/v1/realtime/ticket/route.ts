// POST /v1/realtime/ticket — ТЗ §15. A browser cannot send an Authorization
// header on a WebSocket, so it asks here for a short-lived ticket naming the
// channels it may hear. Which channels those are is a question only the web
// process can answer: it knows the session, the wallets and the assets.
import type { NextRequest } from "next/server";
import { ok, sessionUser } from "@/lib/exchange/api";
import {
  TICKET_TTL_SECONDS,
  issueTicket,
  orderbookChannel,
  telemetryChannel,
  tradesChannel,
  walletChannel,
} from "@/lib/exchange/realtime";
import { prisma } from "@/lib/prisma";
import { readTicketForUser } from "@/lib/work/ticket-access";

export async function POST(request: NextRequest) {
  const user = await sessionUser();

  // Order books and trades are public — the terminal shows them to visitors.
  const zones = await prisma.gridZone.findMany({ select: { code: true } });
  const channels = zones.flatMap((z) => [orderbookChannel(z.code), tradesChannel(z.code)]);

  if (user) {
    channels.push(walletChannel(user.id));
    // Own assets only: telemetry is an operational detail of one producer.
    const assets = await prisma.asset.findMany({
      where: { company: { ownerUserId: user.id } },
      select: { id: true },
    });
    channels.push(...assets.map((a) => telemetryChannel(a.id)));

    // §51 — the conversation on one support ticket. Asked for by name rather
    // than listed: a support agent may read hundreds of tickets, and a page
    // only ever watches the one it shows.
    const asked = await readAskedChannel(request);
    if (asked?.startsWith("ticket.")) {
      const ticketId = asked.slice("ticket.".length);
      const seen = await readTicketForUser(ticketId, user.id, user.role ?? "USER");
      if (seen) channels.push(asked);
    }
  }

  return ok({
    ticket: issueTicket({ userId: user?.id ?? null, channels }),
    expiresInSeconds: TICKET_TTL_SECONDS,
    channels,
  });
}

/** The channel a page asks for, if the body names one. */
async function readAskedChannel(request: NextRequest): Promise<string | null> {
  try {
    const body = (await request.json()) as { channel?: unknown };
    return typeof body?.channel === "string" ? body.channel : null;
  } catch {
    // No body at all: every other page asks for the default list.
    return null;
  }
}
