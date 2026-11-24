// The receipt a buyer opens from the wallet history — ТЗ §46, US-07
// ("чек в истории"). A receipt that is not yours does not exist here.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { readReceiptForUser } from "@/lib/exchange/payment-service";

export const dynamic = "force-dynamic";

type TradeBreakdown = {
  kind?: string;
  amountKwh?: number;
  price?: number;
  notional?: number;
  buyerFee?: number;
  sellerFee?: number;
  zone?: string;
};

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/wallet/receipts/${id}`);
  }

  const receipt = await readReceiptForUser(id, session.user.id, session.user.role === "ADMIN");
  if (!receipt) notFound();

  const t = await getTranslations("exchange.receipt");
  const b = (receipt.breakdown ?? {}) as TradeBreakdown;

  return (
    <div>
      <Link
        href={`/${locale}/me/wallet`}
        prefetch={false}
        className="text-[12px] text-muted underline hover:text-foreground"
      >
        ← {t("back")}
      </Link>
      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-6 text-[28px] font-bold">
        {receipt.paymentId ? t("kindCharge") : t("kindTrade")}
      </h1>

      <dl className="max-w-[520px] text-sm" data-testid="receipt">
        <Row label={t("issuedAt")} value={receipt.issuedAt.toISOString().slice(0, 19).replace("T", " ")} />
        {b.zone && <Row label={t("zone")} value={b.zone} />}
        <Row label={t("kwh")} value={`${receipt.totalKwh.toFixed(3)} kWh`} />
        {b.price != null && (
          <Row label={t("price")} value={`${b.price.toFixed(4)} ${receipt.currency}/kWh`} />
        )}
        {b.notional != null && (
          <Row label={t("notional")} value={`${b.notional.toFixed(2)} ${receipt.currency}`} />
        )}
        {b.buyerFee != null && (
          <Row label={t("fee")} value={`${b.buyerFee.toFixed(2)} ${receipt.currency}`} />
        )}
        <Row
          label={t("total")}
          value={`${receipt.totalFiat.toFixed(2)} ${receipt.currency}`}
          strong
        />
        <Row label={t("reference")} value={receipt.tradeId ?? receipt.paymentId ?? receipt.id} />
      </dl>

      {receipt.burnedTokenIds.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-[13px] uppercase tracking-[0.14em] text-muted">
            {t("tokens")}
          </h2>
          <ul className="num space-y-0.5 text-[12px] text-muted">
            {receipt.burnedTokenIds.map((tokenId) => (
              <li key={tokenId}>{tokenId}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between border-b border-hairline py-2">
      <dt className="text-muted">{label}</dt>
      <dd className={`num ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
