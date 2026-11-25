// §46 item 8 — the page behind the QR code on a printed receipt. Open to
// anyone holding the paper, so it carries proof and no personal data.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { verifyReceipt } from "@/lib/receipts/receipt-verify";

export const dynamic = "force-dynamic";

export default async function VerifyReceiptPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  setRequestLocale(locale);

  const proof = await verifyReceipt(code);
  if (!proof) notFound();

  const t = await getTranslations("receipt");
  const kindLabel =
    proof.kind === "charge"
      ? t("kindCharge")
      : proof.kind === "trade"
        ? t("kindTrade")
        : proof.kind === "reservation.no_show"
          ? t("kindNoShow")
          : t("kindOther");

  return (
    <main className="mx-auto max-w-[480px] px-4 py-12">
      <div className="text-[13px] font-bold tracking-[0.22em] text-accent">POOLWATT</div>
      <h1 className="mt-4 text-[24px] font-bold text-green" data-testid="verify-ok">
        {t("verifyGenuine")}
      </h1>
      <p className="mt-1 text-[13px] text-muted">{t("verifyHint")}</p>

      <dl
        className="mt-6 rounded-lg border border-hairline bg-card p-5 text-[13px]"
        data-testid="verify-proof"
      >
        <Row label={t("number")} value={proof.number ?? "—"} />
        <Row
          label={t("issuedAt")}
          value={proof.issuedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC"}
        />
        <Row label={t("kindLabel")} value={kindLabel} />
        {proof.networkName && <Row label={t("network")} value={proof.networkName} />}
        {proof.pointName && <Row label={t("point")} value={proof.pointName} />}
        <Row label={t("kwh")} value={`${proof.totalKwh.toFixed(3)} kWh`} />
        <Row label={t("total")} value={`${proof.totalFiat.toFixed(2)} ${proof.currency}`} strong />
      </dl>
    </main>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-hairline py-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className={`num text-right ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
