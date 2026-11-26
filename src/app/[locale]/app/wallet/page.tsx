// §22.3 "Кошелёк" — балансы кВт·ч и денег, покупка впрок (US-07), средняя
// цена покупки, подарки §43 отдельным блоком и история операций с фильтром.
// Та же логика, что в кабинете, но в одну колонку и под палец.

import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWallets } from "@/lib/exchange/wallet-service";
import { quoteMarketOrder } from "@/lib/exchange/order-service";
import { walletChannel } from "@/lib/exchange/realtime";
import { roundMoney } from "@/lib/exchange/precision";
import {
  ALL_HISTORY_KINDS,
  readPurchaseStats,
  readWalletHistory,
} from "@/lib/exchange/wallet-history";
import {
  HISTORY_FILTERS,
  kindsForFilter,
  parseHistoryFilter,
  type HistoryFilter,
} from "@/lib/mobile/history-filter";
import { readMyGifts } from "@/lib/marketing/grant-spend";
import { Screen } from "@/components/mobile/screen";
import { MobileBalance } from "@/components/mobile/mobile-balance";
import { BuySheet } from "@/components/mobile/buy-sheet";
import { HistoryList } from "@/components/mobile/history-list";

export const dynamic = "force-dynamic";

/** §22.3 — суммы, которые покупаются одним нажатием. */
const QUICK_AMOUNTS = [10, 50, 100];

export default async function WalletScreen({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const { locale } = await params;
  const { kind } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/app/wallet`);
  const userId = session.user.id;

  const t = await getTranslations("app.tabs");
  const tw = await getTranslations("app.wallet");
  const th = await getTranslations("app.history");
  const tHome = await getTranslations("app.home");

  const filter = parseHistoryFilter(kind);

  const [wallets, zones, purchases, gifts, history] = await Promise.all([
    readWallets(userId),
    prisma.gridZone.findMany({ orderBy: { code: "asc" } }),
    readPurchaseStats(userId),
    readMyGifts(userId),
    readWalletHistory(userId, { kinds: kindsForFilter(filter) }),
  ]);

  // Зона по умолчанию — та, где у человека больше всего кВт·ч.
  const primary = wallets.slice().sort((a, b) => b.kwhBalance - a.kwhBalance)[0] ?? null;
  const defaultZone =
    (primary ? zones.find((z) => z.id === primary.zoneId) : undefined) ?? zones[0];

  // US-07 "в один клик" — цена каждой суммы считается по живой книге до
  // того, как человек нажмёт. Зона, в книге которой объёма не хватает,
  // вместо цены говорит «нет в продаже» (§16.7).
  const quotes = await Promise.all(
    zones.flatMap((zone) =>
      QUICK_AMOUNTS.map(async (amountKwh) => {
        const quote = await quoteMarketOrder(zone.id, "BUY", amountKwh);
        return {
          zoneId: zone.id,
          amountKwh,
          estimate: quote.unavailableKwh > 0 ? null : roundMoney(quote.notional),
        };
      }),
    ),
  );

  const chips = Object.fromEntries(
    HISTORY_FILTERS.map((f) => [f, th(f)]),
  ) as Record<HistoryFilter, string>;

  const kinds = Object.fromEntries(
    ALL_HISTORY_KINDS.map((k) => [`kind${k}`, th(`kind${k}`)]),
  );

  return (
    <Screen title={t("wallet")}>
      <MobileBalance
        initial={wallets}
        channel={walletChannel(userId)}
        detail
        labels={{
          money: tHome("money"),
          reserved: tw("reserved"),
          available: tw("available"),
          live: tw("live"),
          offline: tw("offline"),
          empty: tw("noWallet"),
        }}
      />

      <section className="mt-8">
        <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">
          {tw("buyAhead")}
        </h2>
        <p className="mt-1 text-[12px] text-muted">{tw("buyAheadHelp")}</p>
        {defaultZone && (
          <BuySheet
            zones={zones.map((z) => ({ id: z.id, code: z.code, currency: z.currency }))}
            defaultZoneId={defaultZone.id}
            quotes={quotes}
            labels={{
              amount: tw("amount"),
              limitPrice: tw("limitPrice"),
              buy: tw("buy"),
              otherAmount: tw("otherAmount"),
              noLiquidity: tw("noLiquidity"),
            }}
          />
        )}
      </section>

      <section className="mt-8 rounded-lg border border-hairline bg-card px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-muted">{tw("avgPrice")}</span>
          <span className="num text-[15px]" data-testid="avg-price">
            {purchases.avgPrice == null ? "—" : purchases.avgPrice.toFixed(4)}
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-[13px] text-muted">{tw("boughtKwh")}</span>
          <span className="num text-[15px]">{purchases.boughtKwh.toFixed(3)} kWh</span>
        </div>
      </section>

      {/* §43 "в приложении показывается отдельно от основного баланса". */}
      {gifts.length > 0 && (
        <section className="mt-8" data-testid="wallet-gifts">
          <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">
            {tw("gifts")}
          </h2>
          <p className="mt-1 text-[12px] text-muted">{tw("giftsHelp")}</p>
          <ul className="mt-3 divide-y divide-hairline rounded-lg border border-hairline bg-card">
            {gifts.map((g) => (
              <li key={g.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[14px]">{g.networkName}</div>
                  <div className="text-[12px] text-muted">
                    {tw("giftUntil")}{" "}
                    <span className="num">{g.expiresAt.toISOString().slice(0, 10)}</span>
                    {g.kind === "cashback" && ` · ${tw("giftCashback")}`}
                  </div>
                </div>
                <div className="num pl-3 text-[15px] text-accent">
                  {g.remainingKwh.toFixed(3)} kWh
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-[12px] uppercase tracking-[0.16em] text-muted">
          {th("title")}
        </h2>
        <HistoryList
          entries={history}
          filter={filter}
          basePath={`/${locale}/app/wallet`}
          receiptPath={(id) => `/${locale}/app/wallet/receipts/${id}`}
          labels={{ empty: th("empty"), chips, kinds }}
        />
      </section>
    </Screen>
  );
}
