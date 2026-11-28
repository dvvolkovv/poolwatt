// Дом кабинета. ТЗ §22.2 — "баланс кВт·ч крупно, денежный баланс, бейдж
// статуса, текущая цена кВт·ч в зоне, быстрые кнопки"; US-17 — баланс держит
// себя свежим каналом §15.
//
// Что изменилось 2026-11-28: навигация кабинета перестала быть полосой из
// десяти текстовых ссылок (её рисовал `me/layout.tsx` под `overflow-x-auto`,
// одинаковую для всех) и стала доской плиток. Живой баланс и цена зоны
// остались там же, где были: это требование §22.2, а не украшение. Четыре
// быстрые кнопки §22.2 стали плитками, и две из них по-прежнему говорят,
// чего ждут.
//
// Во главе страницы в тот же день стоял квадрат с именем человека во всю
// ширину. Владелец прошёл кабинет с телефона и попросил его убрать: учётная
// запись и вход в неё — сбоку, в шапке (`AccountPill`), а первый экран
// кабинета пусть занимают баланс и разделы. Остался заголовок и бейдж
// статуса одной строкой.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { numOrNull } from "@/lib/exchange/decimal";
import { transfersOpen } from "@/lib/exchange/gates";
import { readOrderBook } from "@/lib/exchange/order-service";
import { readWallets } from "@/lib/exchange/wallet-service";
import { intervalStartFor } from "@/lib/exchange/zone-service";
import { walletChannel } from "@/lib/exchange/realtime";
import { readCabinetContext } from "@/lib/cabinet/context";
import { accentStyle } from "@/lib/cabinet/accents";
import { LiveBalanceSummary } from "@/components/exchange/live-balance-summary";
import { CabinetBoard } from "@/components/cabinet/board";

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
  const tTiles = await getTranslations("cabinetTiles");

  const [ctx, wallets] = await Promise.all([
    readCabinetContext(userId, session.user.role === "ADMIN"),
    readWallets(userId),
  ]);

  // §22.2 "текущая цена кВт·ч в зоне" — зоны кошелька, за интервал, который
  // торгуется прямо сейчас.
  const zone = wallets[0]
    ? await prisma.gridZone.findUnique({ where: { id: wallets[0].zoneId } })
    : await prisma.gridZone.findFirst({ orderBy: { code: "asc" } });
  const book = zone
    ? await readOrderBook(
        zone.id,
        intervalStartFor(new Date(), zone.intervalMinutes),
      )
    : null;

  return (
    <div style={accentStyle(ctx.accent)}>
      {/* Заголовок страницы и бейдж статуса — одной строкой. До 2026-11-28
          здесь стоял квадрат во всю ширину с именем человека: владелец
          попросил его убрать, оставив учётную запись только сбоку, в шапке.
          Бейдж статуса остаётся: его требует §22.2, а квадрат не требовал
          никто. */}
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] sm:text-[26px] font-bold leading-none tracking-[-0.02em] text-foreground">
          {tTiles("boards.root")}
        </h1>
        <span
          data-testid="status-badge"
          className="num text-[11px] uppercase tracking-[0.18em] text-[color:var(--tile-line-strong)]"
        >
          {t(`status.${ctx.status}`)}
        </span>
      </div>

      <section className="mb-6">
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
        <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Figure
            label={t("zonePrice")}
            value={fmt(numOrNull(zone.spotPrice), zone.currency)}
          />
          <Figure
            label={t("bestAsk")}
            value={fmt(book?.bestAsk ?? null, zone.currency)}
          />
          <Figure label={t("zone")} value={zone.code} />
        </section>
      )}

      <CabinetBoard
        board="root"
        locale={locale}
        ctx={ctx}
        gates={{
          transfers: transfersOpen(),
          // §19, US-07 — положить деньги на счёт нечем, пока нет платёжного
          // провайдера. Плитка остаётся на месте и говорит, чего ждёт.
          fiatTopUp: Boolean(process.env.PAYMENT_PROVIDER),
        }}
      />
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--tile-line)] p-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
        {label}
      </div>
      <div className="num mt-1 text-[16px]">{value}</div>
    </div>
  );
}

function fmt(value: number | null, currency: string): string {
  return value == null ? "—" : `${value.toFixed(4)} ${currency}`;
}
