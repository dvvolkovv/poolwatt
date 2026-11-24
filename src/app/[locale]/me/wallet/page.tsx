// The kWh wallet — ТЗ §7 and §22.3 "Кошелёк": both balances, buy-ahead,
// operation history and receipts.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { roundPrice } from "@/lib/exchange/precision";
import { readWallets } from "@/lib/exchange/wallet-service";
import { BuyAheadForm } from "@/components/exchange/buy-ahead-form";

export const dynamic = "force-dynamic";

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

  const [wallets, zones, account, buys, receipts] = await Promise.all([
    readWallets(userId),
    prisma.gridZone.findMany({ orderBy: { code: "asc" } }),
    prisma.settlementAccount.findUnique({ where: { userId } }),
    prisma.trade.findMany({
      where: { buyOrder: { wallet: { ownerUserId: userId } } },
      select: { amountKwh: true, price: true },
    }),
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
      },
    }),
  ]);

  // §7 "средняя цена покупки" — volume-weighted across every buy fill.
  const boughtKwh = buys.reduce((sum, b) => sum + num(b.amountKwh), 0);
  const boughtValue = buys.reduce((sum, b) => sum + num(b.amountKwh) * num(b.price), 0);
  const avgPrice = boughtKwh > 0 ? roundPrice(boughtValue / boughtKwh) : null;

  const defaultZone = wallets[0]
    ? zones.find((z) => z.id === wallets[0].zoneId) ?? zones[0]
    : zones[0];

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="text-[28px] font-bold mb-6">{t("title")}</h1>

      {wallets.length === 0 ? (
        <p className="text-sm text-muted mb-8">{t("noWallet")}</p>
      ) : (
        <div className="space-y-4 mb-10">
          {wallets.map((w) => (
            <section key={w.id} className="border border-hairline rounded p-4">
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-[12px] uppercase tracking-[0.14em] text-muted">
                  {t("zone")} {w.zoneCode}
                </span>
                <Link
                  href={`/${locale}/exchange?zone=${w.zoneCode}`}
                  prefetch={false}
                  className="text-[12px] underline text-muted hover:text-foreground"
                >
                  {w.currency}
                </Link>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Figure label={t("kwhBalance")} value={`${w.kwhBalance.toFixed(3)}`} unit="kWh" big />
                <Figure label={t("fiatBalance")} value={w.fiatBalance.toFixed(2)} unit={w.currency} />
                <Figure label={t("reserved")} value={w.reservedFiat.toFixed(2)} unit={w.currency} />
                <Figure label={t("available")} value={w.availableFiat.toFixed(2)} unit={w.currency} />
              </div>
            </section>
          ))}
        </div>
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
              labels={{
                amount: t("amount"),
                limitPrice: t("limitPrice"),
                buy: t("buy"),
              }}
            />
          )}
        </div>

        <div>
          <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted mb-3">
            {t("account")}
          </h2>
          {account ? (
            <dl className="text-sm space-y-1">
              <div className="flex justify-between">
                <dt className="text-muted">IBAN</dt>
                <dd className="num">{account.iban}</dd>
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
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} className="border-b border-hairline">
                  <td className="py-2 num text-muted">
                    {r.issuedAt.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td>{r.paymentId ? "charge" : "trade"}</td>
                  <td className="text-right num">{num(r.totalKwh).toFixed(3)}</td>
                  <td className="text-right num">
                    {num(r.totalFiat).toFixed(2)} {r.currency}
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
