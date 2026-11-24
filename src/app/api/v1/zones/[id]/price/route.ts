// GET /v1/zones/{id}/price — ТЗ §15: current price and the spot reference.
import { domainError, ok } from "@/lib/exchange/api";
import { numOrNull } from "@/lib/exchange/decimal";
import { readOrderBook } from "@/lib/exchange/order-service";
import { intervalStartFor, requireZone } from "@/lib/exchange/zone-service";
import { prisma } from "@/lib/prisma";
import { roundPrice } from "@/lib/exchange/precision";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const zone = await requireZone(id);
    const now = new Date();
    const currentInterval = intervalStartFor(now, zone.intervalMinutes);
    const book = await readOrderBook(zone.id, currentInterval);

    // Last traded price in the zone — the app's "текущая цена кВт·ч".
    const lastTrade = await prisma.trade.findFirst({
      where: { zoneId: zone.id },
      orderBy: { executedAt: "desc" },
      select: { price: true, executedAt: true },
    });

    const mid =
      book.bestBid != null && book.bestAsk != null
        ? roundPrice((book.bestBid + book.bestAsk) / 2)
        : null;

    return ok({
      zone: { id: zone.id, code: zone.code, currency: zone.currency },
      intervalStart: currentInterval.toISOString(),
      spotPrice: numOrNull(zone.spotPrice),
      spotPriceAt: zone.spotPriceAt?.toISOString() ?? null,
      corridor: book.corridor,
      bestBid: book.bestBid,
      bestAsk: book.bestAsk,
      midPrice: mid,
      lastPrice: lastTrade ? numOrNull(lastTrade.price) : null,
      lastTradeAt: lastTrade?.executedAt.toISOString() ?? null,
    });
  } catch (err) {
    return domainError(err);
  }
}
