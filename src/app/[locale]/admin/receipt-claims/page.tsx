// §46 — "Ошибочный чек ... бухгалтер возвращает в поддержку Poolwatt".
//
// This is that support desk. Each claim shows the document as it stands, what
// the accountant says is wrong, the fields the regulation allows to change,
// and the journal of what has already been done to this receipt.

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { readClaimQueue } from "@/lib/receipts/receipt-claims";
import { readCorrectionJournal } from "@/lib/receipts/receipt-correction";
import { readReceiptDocument } from "@/lib/receipts/receipt-store";
import { ClaimResolver, type ClaimField } from "@/components/receipts/claim-resolver";

export const dynamic = "force-dynamic";

export default async function ReceiptClaimsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("adminReceiptClaims");
  const claims = await readClaimQueue();

  // The document behind every open claim, so support reads what the
  // accountant reads — and the journal of this receipt either way.
  const details = await Promise.all(
    claims.map(async (claim) => ({
      claim,
      doc: await readReceiptDocument(claim.receiptId),
      journal: await readCorrectionJournal(claim.receiptId),
    })),
  );

  const stamp = (d: Date | null) =>
    d ? d.toISOString().replace("T", " ").replace(/\..*Z$/, "Z") : "—";

  return (
    <div>
      <h1 className="text-[22px] font-semibold">{t("title")}</h1>
      <p className="mb-6 mt-1 max-w-[90ch] text-[13px] text-muted">{t("intro")}</p>

      {details.length === 0 ? (
        <p className="text-[13px] text-muted" data-testid="claims-empty">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-6" data-testid="claim-list">
          {details.map(({ claim, doc, journal }) => {
            const fields: ClaimField[] = [
              { field: "network.legalName", label: t("field.legalName"), current: doc?.network?.legalName ?? "" },
              { field: "network.regNumber", label: t("field.regNumber"), current: doc?.network?.regNumber ?? "" },
              { field: "network.vatNumber", label: t("field.vatNumber"), current: doc?.network?.vatNumber ?? "" },
              { field: "network.address", label: t("field.address"), current: doc?.network?.address ?? "" },
              { field: "vat.ratePct", label: t("field.vatRate"), current: doc?.vat?.ratePct != null ? String(doc.vat.ratePct) : "" },
              { field: "taxNote", label: t("field.taxNote"), current: doc?.taxNote ?? "" },
              { field: "session.pointName", label: t("field.pointName"), current: doc?.session?.pointName ?? "" },
              { field: "session.pointAddress", label: t("field.pointAddress"), current: doc?.session?.pointAddress ?? "" },
              { field: "session.connector", label: t("field.connector"), current: doc?.session?.connector ?? "" },
            ];

            return (
              <li
                key={claim.id}
                className="rounded-lg border border-hairline p-4"
                data-testid="claim-card"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="text-[15px] font-medium">
                    {claim.receiptNumber ?? claim.receiptId}
                    <span className="ml-2 text-[12px] text-muted">
                      {claim.operatorName ?? "—"} · {t(`reason.${claim.reason}`)}
                    </span>
                  </span>
                  <span className="text-[12px] text-muted">
                    {t(`status.${claim.status}`)} · {stamp(claim.createdAt)} · {claim.claimedBy}
                  </span>
                </div>

                <blockquote className="mt-2 border-l-2 border-hairline pl-3 text-[13px]">
                  {claim.comment}
                </blockquote>

                <p className="mt-2 text-[12px]">
                  <Link
                    href={`/${locale}/me/wallet/receipts/${claim.receiptId}`}
                    prefetch={false}
                    className="underline hover:text-accent"
                    data-testid="claim-receipt-link"
                  >
                    {t("openReceipt")} →
                  </Link>
                  {doc && (
                    <span className="ml-3 text-muted">
                      <span className="num">{doc.totalFiat.toFixed(2)}</span> {doc.currency} ·{" "}
                      <span className="num">{doc.totalKwh.toFixed(3)}</span> kWh
                    </span>
                  )}
                </p>

                {claim.status === "OPEN" ? (
                  <ClaimResolver
                    claimId={claim.id}
                    fields={fields}
                    labels={{
                      correct: t("correct"),
                      reject: t("reject"),
                      note: t("note"),
                      rejectReason: t("rejectReason"),
                      done: t("corrected"),
                      rejected: t("rejectedDone"),
                      keep: t("keep"),
                    }}
                  />
                ) : (
                  <p className="mt-3 text-[13px]">
                    {t(`status.${claim.status}`)}
                    {claim.resolution ? `: ${claim.resolution}` : ""}
                    {claim.issuedReceiptId && (
                      <>
                        {" · "}
                        <Link
                          href={`/${locale}/me/wallet/receipts/${claim.issuedReceiptId}`}
                          prefetch={false}
                          className="underline hover:text-accent"
                        >
                          {claim.issuedReceiptNumber ?? t("newVersion")}
                        </Link>
                      </>
                    )}
                  </p>
                )}

                {journal.length > 0 && (
                  <div className="mt-4 border-t border-hairline pt-3" data-testid="claim-journal">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-muted">
                      {t("journal")}
                    </div>
                    <ul className="mt-2 space-y-2 text-[12px]">
                      {journal.map((entry) => (
                        <li key={entry.id}>
                          <span className="text-muted">
                            {stamp(entry.at)} · {entry.by} · {entry.fromNumber} → {entry.toNumber}
                          </span>
                          <ul className="ml-4 list-disc">
                            {entry.changes.map((c) => (
                              <li key={c.field}>
                                {c.field}: <s>{String(c.before ?? "—")}</s> →{" "}
                                <strong>{String(c.after ?? "—")}</strong>
                              </li>
                            ))}
                          </ul>
                          {entry.note && <p className="ml-4 text-muted">{entry.note}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
