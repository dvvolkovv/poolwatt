// POST /v1/realtime/ticket — ТЗ §15. A browser cannot send an Authorization
// header on a WebSocket, so it asks here for a short-lived ticket naming the
// channels it may hear. Which channels those are is a question only the web
// process can answer: it knows the session, the wallets and the assets.
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

export async function POST() {
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
  }

  return ok({
    ticket: issueTicket({ userId: user?.id ?? null, channels }),
    expiresInSeconds: TICKET_TTL_SECONDS,
    channels,
  });
}
