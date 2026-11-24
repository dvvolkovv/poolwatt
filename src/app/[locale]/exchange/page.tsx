// The wholesale trading terminal — ТЗ §6 and §9 "Веб-терминал оптового
// потребителя": order book of the zone and interval on the left, the order
// form on the right, the trader's own orders below.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num, numOrNull } from "@/lib/exchange/decimal";
import { readOrderBook } from "@/lib/exchange/order-service";
import { intervalStartFor } from "@/lib/exchange/zone-service";
import { readWallets } from "@/lib/exchange/wallet-service";
import { OrderTicket } from "@/components/exchange/order-ticket";
import { CancelOrderButton } from "@/components/exchange/cancel-order-button";

export const dynamic = "force-dynamic";

const OPEN_STATUSES = ["NEW", "PARTIALLY_FILLED"] as const;

export default async function ExchangePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ zone?: string; interval?: string }>;
}) {
  const { locale } = await params;
  const { zone: zoneCode, interval } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("exchange");

  const zones = await prisma.gridZone.findMany({ orderBy: { code: "asc" } });
  if (zones.length === 0) notFound();
  const zone = zones.find((z) => z.code === zoneCode?.toUpperCase()) ?? zones[0];

  // Default to the interval that is open for trading right now.
  const parsed = interval ? new Date(interval) : null;
  const intervalStart =
    parsed && !Number.isNaN(parsed.getTime())
      ? intervalStartFor(parsed, zone.intervalMinutes)
      : intervalStartFor(new Date(), zone.intervalMinutes);

  const book = await readOrderBook(zone.id, intervalStart);

  const session = await auth();
  const userId = session?.user?.id ?? null;

  const [wallets, myOrders, recentTrades] = await Promise.all([
    userId ? readWallets(userId) : Promise.resolve([]),
    userId
      ? prisma.order.findMany({
          where: { zoneId: zone.id, wallet: { ownerUserId: userId } },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : Promise.resolve([]),
    prisma.trade.findMany({
      where: { zoneId: zone.id },
      orderBy: { executedAt: "desc" },
      take: 12,
      select: { id: true, amountKwh: true, price: true, executedAt: true },
    }),
  ]);

  const wallet = wallets.find((w) => w.zoneId === zone.id) ?? null;
  const maxAsk = Math.max(1, ...book.asks.map((a) => a.amountKwh));
  const maxBid = Math.max(1, ...book.bids.map((b) => b.amountKwh));

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-8 md:py-12">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
              {t("eyebrow")}
            </div>
            <h1 className="text-[28px] font-bold">{t("title")}</h1>
          </div>
          <nav className="flex gap-2 text-sm">
            {zones.map((z) => (
              <Link
                key={z.id}
                href={`/${locale}/exchange?zone=${z.code}`}
                prefetch={false}
                className={`px-3 py-1.5 rounded border ${
                  z.id === zone.id
                    ? "border-accent text-accent"
                    : "border-hairline text-muted hover:text-foreground"
                }`}
              >
                {z.code}
              </Link>
            ))}
          </nav>
        </header>

        <section className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          <Stat label={t("stats.interval")} value={formatInterval(intervalStart, zone.intervalMinutes)} />
          <Stat
            label={t("stats.spot")}
            value={fmtPrice(numOrNull(zone.spotPrice), zone.currency)}
          />
          <Stat
            label={t("stats.corridor")}
            value={
              book.corridor
                ? `${book.corridor.min.toFixed(4)} – ${book.corridor.max.toFixed(4)}`
                : "—"
            }
          />
          <Stat label={t("stats.bestBid")} value={fmtPrice(book.bestBid, zone.currency)} />
          <Stat label={t("stats.bestAsk")} value={fmtPrice(book.bestAsk, zone.currency)} />
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
          <section>
            <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted mb-3">
              {t("book.title")}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <BookSide
                title={t("book.bids")}
                rows={book.bids}
                max={maxBid}
                tone="up"
                currency={zone.currency}
                emptyLabel={t("book.empty")}
              />
              <BookSide
                title={t("book.asks")}
                rows={book.asks}
                max={maxAsk}
                tone="down"
                currency={zone.currency}
                emptyLabel={t("book.empty")}
              />
            </div>

            <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted mt-10 mb-3">
              {t("trades.title")}
            </h2>
            {recentTrades.length === 0 ? (
              <p className="text-sm text-muted">{t("trades.empty")}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-muted">
                    <th className="py-2">{t("trades.time")}</th>
                    <th className="text-right">{t("trades.amount")}</th>
                    <th className="text-right">{t("trades.price")}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades.map((tr) => (
                    <tr key={tr.id} className="border-b border-hairline">
                      <td className="py-2 num text-muted">
                        {tr.executedAt.toISOString().slice(11, 16)}
                      </td>
                      <td className="text-right num">{num(tr.amountKwh).toFixed(3)}</td>
                      <td className="text-right num">{num(tr.price).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <aside>
            {userId ? (
              <OrderTicket
                zoneId={zone.id}
                zoneCode={zone.code}
                currency={zone.currency}
                intervalStart={intervalStart.toISOString()}
                bestBid={book.bestBid}
                bestAsk={book.bestAsk}
                corridor={book.corridor}
                kwhBalance={wallet?.kwhBalance ?? 0}
                availableFiat={wallet?.availableFiat ?? 0}
                labels={{
                  title: t("ticket.title"),
                  buy: t("ticket.buy"),
                  sell: t("ticket.sell"),
                  market: t("ticket.market"),
                  limit: t("ticket.limit"),
                  amount: t("ticket.amount"),
                  price: t("ticket.price"),
                  interval: t("ticket.interval"),
                  estimate: t("ticket.estimate"),
                  balanceKwh: t("ticket.balanceKwh"),
                  availableFiat: t("ticket.availableFiat"),
                  submit: t("ticket.submit"),
                  corridorHint: t("ticket.corridorHint"),
                  filled: t("ticket.filled"),
                  rejected: t("ticket.rejected"),
                }}
              />
            ) : (
              <div className="border border-hairline rounded p-4 text-sm">
                <p className="text-muted mb-3">{t("ticket.loginRequired")}</p>
                <Link
                  href={`/${locale}/login?callbackUrl=/${locale}/exchange`}
                  className="underline"
                >
                  {t("ticket.login")}
                </Link>
              </div>
            )}

            {userId && (
              <div className="mt-8">
                <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted mb-3">
                  {t("myOrders.title")}
                </h2>
                {myOrders.length === 0 ? (
                  <p className="text-sm text-muted">{t("myOrders.empty")}</p>
                ) : (
                  <ul className="text-sm divide-y divide-hairline">
                    {myOrders.map((o) => {
                      const open = (OPEN_STATUSES as readonly string[]).includes(o.status);
                      return (
                        <li key={o.id} className="py-2.5 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={o.side === "BUY" ? "text-up" : "text-down"}
                              >
                                {o.side}
                              </span>
                              <span className="num">{num(o.amountKwh).toFixed(3)} kWh</span>
                              {o.limitPrice && (
                                <span className="num text-muted">
                                  @ {num(o.limitPrice).toFixed(4)}
                                </span>
                              )}
                            </div>
                            <div className="text-[12px] text-muted">
                              {o.status}
                              {num(o.filledKwh) > 0 && (
                                <span className="num">
                                  {" "}
                                  · {num(o.filledKwh).toFixed(3)} {t("myOrders.filled")}
                                </span>
                              )}
                              {o.rejectReason && <> · {o.rejectReason}</>}
                            </div>
                          </div>
                          {open && <CancelOrderButton orderId={o.id} label={t("myOrders.cancel")} />}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-hairline rounded p-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="text-[16px] num mt-1">{value}</div>
    </div>
  );
}

function BookSide({
  title,
  rows,
  max,
  tone,
  currency,
  emptyLabel,
}: {
  title: string;
  rows: { price: number; amountKwh: number; orders: number }[];
  max: number;
  tone: "up" | "down";
  currency: string;
  emptyLabel: string;
}) {
  return (
    <div>
      <div className="text-[12px] uppercase tracking-[0.14em] text-muted mb-2">{title}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{emptyLabel}</p>
      ) : (
        <ul className="text-sm">
          {rows.map((r) => (
            <li key={r.price} className="relative border-b border-hairline">
              {/* Depth bar: width is the level's share of the deepest level. */}
              <div
                aria-hidden
                className={`absolute inset-y-0 right-0 ${
                  tone === "up" ? "bg-up/10" : "bg-down/10"
                }`}
                style={{ width: `${Math.max(4, (r.amountKwh / max) * 100)}%` }}
              />
              <div className="relative flex justify-between py-1.5 px-1">
                <span className={`num ${tone === "up" ? "text-up" : "text-down"}`}>
                  {r.price.toFixed(4)}
                </span>
                <span className="num">{r.amountKwh.toFixed(3)}</span>
                <span className="num text-muted text-[12px]">{r.orders}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="text-[11px] text-muted mt-1.5">
        {currency}/kWh · kWh · #
      </div>
    </div>
  );
}

function fmtPrice(value: number | null, currency: string): string {
  return value == null ? "—" : `${value.toFixed(4)} ${currency}`;
}

function formatInterval(start: Date, minutes: number): string {
  const end = new Date(start.getTime() + minutes * 60 * 1000);
  return `${start.toISOString().slice(11, 16)}–${end.toISOString().slice(11, 16)}Z`;
}
