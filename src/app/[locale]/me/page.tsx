// The main screen of ТЗ §22.2 — "баланс кВт·ч крупно, денежный баланс, бейдж
// статуса, текущая цена кВт·ч в зоне, быстрые кнопки". US-17 is the balance
// keeping itself current over the §15 channel.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { numOrNull } from "@/lib/exchange/decimal";
import { transfersOpen } from "@/lib/exchange/gates";
import { readOrderBook } from "@/lib/exchange/order-service";
import { readUserStatus } from "@/lib/exchange/user-status";
import { readWallets } from "@/lib/exchange/wallet-service";
import { intervalStartFor } from "@/lib/exchange/zone-service";
import { walletChannel } from "@/lib/exchange/realtime";
import { LiveBalanceSummary } from "@/components/exchange/live-balance-summary";

export const dynamic = "force-dynamic";

export default async function MainScreen({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me`);
  const userId = session.user.id;

  const t = await getTranslations("cabinet.home");

  const [wallets, status] = await Promise.all([readWallets(userId), readUserStatus(userId)]);

  // §22.2 "текущая цена кВт·ч в зоне" — of the zone the wallet is in, for the
  // interval trading right now.
  const zone = wallets[0]
    ? await prisma.gridZone.findUnique({ where: { id: wallets[0].zoneId } })
    : await prisma.gridZone.findFirst({ orderBy: { code: "asc" } });
  const book = zone
    ? await readOrderBook(zone.id, intervalStartFor(new Date(), zone.intervalMinutes))
    : null;

  const transfers = transfersOpen();

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] font-bold">{session.user.username}</h1>
        <span
          data-testid="status-badge"
          className="rounded-full border border-accent/50 px-2.5 py-0.5 text-[11px] uppercase tracking-[0.12em] text-accent"
        >
          {t(`status.${status}`)}
        </span>
      </div>

      <section className="mb-10">
        <LiveBalanceSummary
          initial={wallets}
          channel={walletChannel(userId)}
          labels={{
            kwhBalance: t("kwhBalance"),
            fiatBalance: t("fiatBalance"),
            available: t("available"),
            live: t("live"),
            offline: t("offline"),
            empty: t("noWallet"),
          }}
        />
      </section>

      {zone && (
        <section className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Figure label={t("zonePrice")} value={fmt(numOrNull(zone.spotPrice), zone.currency)} />
          <Figure label={t("bestAsk")} value={fmt(book?.bestAsk ?? null, zone.currency)} />
          <Figure label={t("zone")} value={zone.code} />
        </section>
      )}

      {/* §22.2 — «Купить», «Перевести», «Зарядиться», «Пополнить». The two
          that depend on the outside world say what they are waiting for
          rather than pretending to work. */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Action href={`/${locale}/me/wallet`} label={t("actions.buy")} />
        {transfers ? (
          <Action href={`/${locale}/me/wallet`} label={t("actions.transfer")} />
        ) : (
          <ActionClosed label={t("actions.transfer")} hint={t("actions.transferClosed")} />
        )}
        <Action href={`/${locale}/navigator`} label={t("actions.charge")} />
        <ActionClosed label={t("actions.topUp")} hint={t("actions.topUpClosed")} />
      </section>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-hairline p-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="num mt-1 text-[16px]">{value}</div>
    </div>
  );
}

function Action({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="rounded border border-hairline px-3 py-3 text-center text-sm hover:border-accent"
    >
      {label}
    </Link>
  );
}

function ActionClosed({ label, hint }: { label: string; hint: string }) {
  return (
    <div
      title={hint}
      aria-disabled="true"
      className="rounded border border-hairline px-3 py-3 text-center text-sm opacity-50"
    >
      {label}
      <span className="mt-0.5 block text-[10px] leading-tight text-muted">{hint}</span>
    </div>
  );
}

function fmt(value: number | null, currency: string): string {
  return value == null ? "—" : `${value.toFixed(4)} ${currency}`;
}
