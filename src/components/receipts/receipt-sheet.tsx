// The printed face of a receipt — ТЗ §46 "Состав чека", in the order the TZ
// lists the items. One component for the wallet, the print view and the
// station terminal: a receipt that looks different depending on where it is
// read is two documents.

import { getTranslations } from "next-intl/server";
import type { ReceiptDocument } from "@/lib/receipts/receipt-document";
import { qrSvg } from "@/lib/receipts/receipt-qr";

function fmtTime(at: Date | null): string | null {
  if (!at) return null;
  return at.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export async function ReceiptSheet({ doc }: { doc: ReceiptDocument }) {
  const t = await getTranslations("receipt");
  const qr = doc.verifyUrl ? await qrSvg(doc.verifyUrl) : null;
  const cur = doc.currency;

  const kindLabel =
    doc.kind === "charge"
      ? t("kindCharge")
      : doc.kind === "trade"
        ? t("kindTrade")
        : doc.kind === "reservation.no_show"
          ? t("kindNoShow")
          : t("kindOther");

  return (
    <article
      className="receipt-sheet mx-auto max-w-[560px] rounded-lg border border-hairline bg-card p-6"
      data-testid="receipt"
    >
      {/* §46.1 — Poolwatt above, the network below, in their own design. */}
      <header className="border-b border-hairline pb-4">
        <div className="text-[13px] font-bold tracking-[0.22em] text-accent">POOLWATT</div>
        {doc.network && (
          <div className="mt-3 flex items-start gap-3">
            {doc.network.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={doc.network.logoUrl}
                alt={doc.network.displayName}
                className="h-10 w-10 rounded-md object-contain"
              />
            )}
            <div className="text-[12px] leading-relaxed">
              <div className="text-[15px] font-semibold">{doc.network.displayName}</div>
              {doc.network.legalName && <div className="text-muted">{doc.network.legalName}</div>}
              {doc.network.address && <div className="text-muted">{doc.network.address}</div>}
              <div className="num text-muted">
                {doc.network.regNumber && <span>{t("regNumber")} {doc.network.regNumber}</span>}
                {doc.network.regNumber && doc.network.vatNumber && <span> · </span>}
                {doc.network.vatNumber && <span>{t("vatNumber")} {doc.network.vatNumber}</span>}
              </div>
            </div>
          </div>
        )}
        <div className="mt-4 flex items-baseline justify-between">
          <h1 className="text-[20px] font-bold">{kindLabel}</h1>
          <div className="num text-[12px] text-muted">{doc.number ?? doc.id}</div>
        </div>
        <div className="num text-[12px] text-muted">{fmtTime(doc.issuedAt)}</div>
      </header>

      {/* §46.2 — point, connector, window. */}
      {doc.session?.pointName && (
        <Section title={t("session")}>
          <Row label={t("point")} value={doc.session.pointName} />
          {doc.session.pointAddress && (
            <Row label={t("address")} value={doc.session.pointAddress} />
          )}
          {doc.session.connector && <Row label={t("connector")} value={doc.session.connector} />}
          {fmtTime(doc.session.startedAt) && (
            <Row label={t("startedAt")} value={fmtTime(doc.session.startedAt)!} />
          )}
          {fmtTime(doc.session.endedAt) && (
            <Row label={t("endedAt")} value={fmtTime(doc.session.endedAt)!} />
          )}
        </Section>
      )}

      {/* §46.3–§46.4 — volume, source, prices. */}
      <Section title={t("energy")}>
        {/* A purchase on the exchange has no point; the zone is its "where". */}
        {!doc.session?.pointName && doc.zone && <Row label={t("zone")} value={doc.zone} />}
        <Row label={t("kwh")} value={`${doc.totalKwh.toFixed(3)} kWh`} />
        {doc.energySources.length > 0 && (
          <Row
            label={t("source")}
            value={doc.energySources.map((s) => t(`sources.${s}`)).join(" + ")}
          />
        )}
        {doc.pricePerKwhFiat != null && (
          <Row label={t("priceFiat")} value={`${doc.pricePerKwhFiat.toFixed(4)} ${cur}/kWh`} />
        )}
        {doc.pricePerKwhTokens != null && (
          <Row label={t("priceTokens")} value={`${doc.pricePerKwhTokens.toFixed(3)} ${t("tokenUnit")}/kWh`} />
        )}
      </Section>

      {/* §46.4 tail — booking fee and its credit. */}
      {(doc.reservationFee != null || doc.reservationCredit != null) && (
        <Section title={t("booking")}>
          {doc.reservationFee != null && (
            <Row label={t("bookingFee")} value={`${doc.reservationFee.toFixed(2)} ${cur}`} />
          )}
          {doc.reservationCredit != null && (
            <Row
              label={t("bookingCredit")}
              value={`−${doc.reservationCredit.toFixed(2)} ${cur}`}
            />
          )}
        </Section>
      )}

      {/* §46.5 — how it was paid. */}
      <Section title={t("split")}>
        {doc.payment.fromBalanceKwh > 0 && (
          <Row
            label={t("fromBalance")}
            value={`${doc.payment.fromBalanceKwh.toFixed(3)} kWh`}
          />
        )}
        {doc.payment.fromGiftKwh > 0 && (
          <Row label={t("fromGift")} value={`${doc.payment.fromGiftKwh.toFixed(3)} kWh`} />
        )}
        {doc.payment.boughtKwh > 0 && (
          <Row
            label={t("bought")}
            value={`${doc.payment.boughtKwh.toFixed(3)} kWh · ${doc.payment.boughtFiat.toFixed(2)} ${cur}`}
          />
        )}
      </Section>

      {/* §8 "Роуминг", US-11 — at which rate another zone's balance paid. */}
      {doc.roaming && (
        <Section title={t("roaming")}>
          <Row
            label={t("roamingFrom")}
            value={`${doc.roaming.kwh.toFixed(3)} kWh · ${doc.roaming.homeZone ?? "—"}`}
          />
          {doc.roaming.conversionRate != null && (
            <Row label={t("roamingRate")} value={doc.roaming.conversionRate.toFixed(4)} />
          )}
          <Row
            label={t("roamingDebit")}
            value={`${doc.roaming.debitedKwh.toFixed(3)} kWh`}
          />
          {doc.roaming.feeKwh > 0 && (
            <Row label={t("roamingFee")} value={`${doc.roaming.feeKwh.toFixed(3)} kWh`} />
          )}
          {doc.roaming.partnerName && (
            <Row label={t("roamingPartner")} value={doc.roaming.partnerName} />
          )}
        </Section>
      )}

      {/* §46.6 — cashback and bonuses, when there are any. */}
      {(doc.cashbackKwh != null || doc.cashbackFiat != null || doc.bonusKwh != null) && (
        <Section title={t("rewards")}>
          {doc.cashbackKwh != null && (
            <Row
              label={
                doc.cashbackPct == null
                  ? t("cashbackKwh")
                  : `${t("cashbackKwh")} ${doc.cashbackPct} %`
              }
              value={`${doc.cashbackKwh.toFixed(3)} kWh`}
            />
          )}
          {doc.cashbackFiat != null && (
            <Row label={t("cashback")} value={`${doc.cashbackFiat.toFixed(2)} ${cur}`} />
          )}
          {doc.bonusKwh != null && (
            <Row label={t("bonus")} value={`${doc.bonusKwh.toFixed(3)} kWh`} />
          )}
        </Section>
      )}

      {/* §46.7 — total and VAT. */}
      <Section title={t("money")}>
        {doc.vat ? (
          <>
            <Row label={t("net")} value={`${doc.vat.net.toFixed(2)} ${cur}`} />
            <Row
              label={`${t("vat")} ${doc.vat.ratePct.toFixed(2)} %`}
              value={`${doc.vat.amount.toFixed(2)} ${cur}`}
            />
          </>
        ) : (
          <Row label={t("vat")} value={t("vatNotStated")} />
        )}
        <Row label={t("total")} value={`${doc.totalFiat.toFixed(2)} ${cur}`} strong />
      </Section>
      {doc.taxNote && <p className="mt-2 text-[11px] text-muted">{doc.taxNote}</p>}

      {/* §46.8 — the QR a tax inspector or a driver can check. */}
      {qr && (
        <div className="mt-6 flex items-center gap-4 border-t border-hairline pt-4">
          <div
            className="h-24 w-24 shrink-0 rounded bg-white p-1.5 [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <div className="text-[11px] text-muted">
            <div>{t("qrHint")}</div>
            <div className="num mt-1 break-all">{doc.verifyUrl}</div>
          </div>
        </div>
      )}

      {doc.burnedTokenIds.length > 0 && (
        <details className="mt-4 text-[11px] text-muted" data-print-hide>
          <summary className="cursor-pointer">{t("tokens")}</summary>
          <ul className="num mt-1 space-y-0.5">
            {doc.burnedTokenIds.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">{title}</h2>
      <dl className="text-[13px]">{children}</dl>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-hairline py-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className={`num text-right ${strong ? "text-[15px] font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
