// The kWh wallet — ТЗ §7 and §22.3 "Кошелёк": both balances, buy-ahead,
// operation history and receipts.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { publishableIban } from "@/lib/exchange/gates";
import { roundMoney } from "@/lib/exchange/precision";
import { readWallets } from "@/lib/exchange/wallet-service";
import { readPurchaseStats } from "@/lib/exchange/wallet-history";
import { quoteMarketOrder } from "@/lib/exchange/order-service";
import { BuyAheadForm } from "@/components/exchange/buy-ahead-form";
import { LiveWallets } from "@/components/exchange/live-wallets";
import { walletChannel } from "@/lib/exchange/realtime";
import { readMyGifts } from "@/lib/marketing/grant-spend";

export const dynamic = "force-dynamic";

/** §22.3 — the amounts the buy screen offers in one click. */
const QUICK_AMOUNTS = [10, 50, 100];

export default async function WalletPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/wallet`);
  const userId = session.user.id;

  const t = await getTranslations("exchange.wallet");
  const tGifts = await getTranslations("gifts");
  const tReceipt = await getTranslations("receipt");

  const [wallets, zones, account, purchases, receipts, gifts] = await Promise.all([
    readWallets(userId),
    prisma.gridZone.findMany({ orderBy: { code: "asc" } }),
    prisma.settlementAccount.findUnique({ where: { userId } }),
    // §22.3 "средняя цена покупки" — тот же сервис, что в телефоне.
    readPurchaseStats(userId),
    prisma.receipt.findMany({
      where: {
        OR: [
          { payment: { wallet: { ownerUserId: userId } } },
          { trade: { buyOrder: { wallet: { ownerUserId: userId } } } },
        ],
      },
      orderBy: { issuedAt: "desc" },
      take: 20,
      select: {
        id: true,
        totalKwh: true,
        totalFiat: true,
        currency: true,
        issuedAt: true,
        paymentId: true,
        tradeId: true,
        payment: { select: { pointId: true } },
      },
    }),
    // §43 — "В приложении показывается отдельно от основного баланса".
    readMyGifts(userId),
  ]);

  const { avgPrice, boughtKwh } = purchases;

  const iban = publishableIban(account?.iban);

  const defaultZone = wallets[0]
    ? zones.find((z) => z.id === wallets[0].zoneId) ?? zones[0]
    : zones[0];

  // US-07 "в один клик" — the cost of each quick amount, priced off the live
  // book before the buyer commits. A zone whose book cannot fill the amount
  // says so instead of quoting (§16.7).
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

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="text-[28px] font-bold mb-6">{t("title")}</h1>

      {wallets.length === 0 ? (
        <p className="text-sm text-muted mb-8">{t("noWallet")}</p>
      ) : (
        // US-17 — the balances keep themselves current over the §15 channel.
        <LiveWallets
          initial={wallets}
          channel={walletChannel(userId)}
          locale={locale}
          labels={{
            zone: t("zone"),
            kwhBalance: t("kwhBalance"),
            fiatBalance: t("fiatBalance"),
            reserved: t("reserved"),
            available: t("available"),
            live: t("live"),
            offline: t("offline"),
          }}
        />
      )}

      {gifts.length > 0 && (
        <section className="mb-10" data-testid="wallet-gifts">
          <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted mb-3">
            {tGifts("title")}
          </h2>
          <ul className="divide-y divide-hairline text-sm mb-3">
            {gifts.slice(0, 3).map((g) => (
              <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <span>{g.networkName}</span>
                <span className="text-[12px] text-muted">
                  <span className="num">{g.remainingKwh}</span> {tGifts("kwh")} ·{" "}
                  {tGifts("until")} {g.expiresAt.toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href={`/${locale}/me/gifts`}
            prefetch={false}
            className="text-[13px] underline hover:text-accent"
          >
            {tGifts("walletLink")} →
          </Link>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
        <div>
          <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted mb-3">
            {t("buyAhead")}
          </h2>
          <p className="text-[12px] text-muted mb-3">{t("buyAheadHelp")}</p>
          {defaultZone && (
            <BuyAheadForm
              zones={zones.map((z) => ({ id: z.id, code: z.code, currency: z.currency }))}
              defaultZoneId={defaultZone.id}
              quotes={quotes}
              labels={{
                amount: t("amount"),
                limitPrice: t("limitPrice"),
                buy: t("buy"),
                quickBuy: t("quickBuy"),
                noLiquidity: t("noLiquidity"),
              }}
            />
          )}
        </div>

        <div>
          <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted mb-3">
            {t("account")}
          </h2>
          {account && iban ? (
            <dl className="text-sm space-y-1">
              <div className="flex justify-between">
                <dt className="text-muted">IBAN</dt>
                <dd className="num">{iban}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{t("fiatBalance")}</dt>
                <dd className="num">
                  {num(account.balance).toFixed(2)} {account.currency}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted">{t("noAccount")}</p>
          )}

          <dl className="text-sm space-y-1 mt-6">
            <div className="flex justify-between">
              <dt className="text-muted">{t("avgPrice")}</dt>
              <dd className="num">{avgPrice == null ? "—" : avgPrice.toFixed(4)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{t("lifetimeBought")}</dt>
              <dd className="num">{boughtKwh.toFixed(3)} kWh</dd>
            </div>
          </dl>
        </div>
      </section>

      <section>
        <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted mb-3">
          {t("receipts")}
        </h2>
        {receipts.length === 0 ? (
          <p className="text-sm text-muted">{t("historyEmpty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-muted">
                <th className="py-2">{t("issuedAt")}</th>
                <th>{t("history")}</th>
                <th className="text-right">{t("receiptKwh")}</th>
                <th className="text-right">{t("receiptTotal")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} className="border-b border-hairline">
                  <td className="py-2 num text-muted">
                    {/* US-07 — the receipt is a document, so it opens. */}
                    <Link
                      href={`/${locale}/me/wallet/receipts/${r.id}`}
                      prefetch={false}
                      className="underline hover:text-foreground"
                    >
                      {r.issuedAt.toISOString().slice(0, 16).replace("T", " ")}
                    </Link>
                  </td>
                  <td>{r.paymentId ? "charge" : "trade"}</td>
                  <td className="text-right num">{num(r.totalKwh).toFixed(3)}</td>
                  <td className="text-right num">
                    {num(r.totalFiat).toFixed(2)} {r.currency}
                  </td>
                  {/* §51.1 — «кнопка доступна … в истории зарядок». Зарядка
                      не в нашей сети жаловаться некому: там нет пункта. */}
                  <td className="text-right">
                    {r.payment?.pointId && (
                      <Link
                        href={`/${locale}/c/${r.payment.pointId}/report?payment=${r.paymentId}`}
                        prefetch={false}
                        data-testid="history-report"
                        className="text-[12px] text-muted underline hover:text-foreground"
                      >
                        {tReceipt("reportProblem")}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Figure({
  label,
  value,
  unit,
  big = false,
}: {
  label: string;
  value: string;
  unit: string;
  big?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={`num ${big ? "text-[26px]" : "text-[18px]"} mt-0.5`}>
        {value} <span className="text-[12px] text-muted">{unit}</span>
      </div>
    </div>
  );
}
