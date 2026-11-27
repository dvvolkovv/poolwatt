// §46 "Бухгалтерия партнёра" / US-46 — the month an accountant exports.
//
// Reachable by the network's owner and by an employee whose role carries
// finance.read (the built-in ACCOUNTANT of §47), and scoped to the points
// that employee was given.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { accountingAccess, readLedger } from "@/lib/accounting/ledger";
import { EXPORT_FORMATS } from "@/lib/accounting/formats";
import { RequisitesForm } from "./requisites-form";
import { ReturnReceiptForm } from "@/components/receipts/return-receipt-form";
import { readClaimsForOperator } from "@/lib/receipts/receipt-claims";

export const dynamic = "force-dynamic";

/** The month to show, as YYYY-MM; defaults to the one that just ended. */
function monthWindow(value: string | undefined, now: Date) {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1;
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  return { from, to, label: `${from.getUTCFullYear()}-${String(month).padStart(2, "0")}` };
}

export default async function AccountingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { locale, id } = await params;
  const { month } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/accounting`);
  }

  const access = await accountingAccess(
    id,
    session.user.id,
    session.user.role === "ADMIN",
  );
  if (!access.allowed) notFound();

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true, accounting: true },
  });
  if (!operator) notFound();

  const t = await getTranslations("accounting");
  const tClaims = await getTranslations("adminReceiptClaims");
  const window = monthWindow(month, new Date());
  // §46 — which documents are already with support, and what came back.
  const claims = await readClaimsForOperator(id, session.user.id);
  const claimByReceipt = new Map(claims.map((c) => [c.receiptId, c]));
  const ledger = await readLedger({
    operatorId: id,
    from: window.from,
    to: window.to,
    pointIds: access.pointIds,
  });

  const acc = operator.accounting;
  const datevReady = Boolean(
    acc?.datevConsultantNo && acc?.datevClientNo && acc?.revenueAccount && acc?.counterAccount,
  );
  const bmdReady = Boolean(acc?.bmdClientNo && acc?.revenueAccount && acc?.counterAccount);
  const formatReady: Record<string, boolean> = {
    csv: true,
    xlsx: true,
    pdf: true,
    datev: datevReady,
    bmd: bmdReady,
  };

  const months = recentMonths(new Date(), 12);

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <Link
          href={`/${locale}/me/charger-operator/${id}`}
          prefetch={false}
          className="text-[13px] text-muted underline hover:text-foreground"
        >
          ← {operator.displayName}
        </Link>
        <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">
          {t("eyebrow")}
        </div>
        <h1 className="text-[28px] font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </div>

      <section>
        <div className="flex flex-wrap items-center gap-2">
          {months.map((m) => (
            <Link
              key={m}
              href={`/${locale}/me/charger-operator/${id}/accounting?month=${m}`}
              prefetch={false}
              className={`num rounded-md border px-2.5 py-1 text-[12px] ${
                m === window.label
                  ? "border-accent text-accent"
                  : "border-hairline text-muted hover:text-foreground"
              }`}
            >
              {m}
            </Link>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-2" data-testid="export-buttons">
          {EXPORT_FORMATS.map((format) =>
            formatReady[format] ? (
              <a
                key={format}
                href={`/api/v1/charger-operators/${id}/accounting/export?month=${window.label}&format=${format}`}
                className="rounded-md border border-hairline px-3 py-1.5 text-[12px] uppercase tracking-[0.1em] hover:border-accent"
                data-testid={`export-${format}`}
              >
                {format}
              </a>
            ) : (
              <span
                key={format}
                title={t("needsAccounts")}
                className="cursor-not-allowed rounded-md border border-hairline px-3 py-1.5 text-[12px] uppercase tracking-[0.1em] text-muted opacity-50"
                data-testid={`export-${format}-closed`}
              >
                {format}
              </span>
            ),
          )}
        </div>
        {(!datevReady || !bmdReady) && (
          <p className="mt-2 text-[12px] text-muted">{t("needsAccounts")}</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[16px] font-semibold">
          {t("lines", { month: window.label })}
        </h2>
        {ledger.lines.length === 0 ? (
          <p className="text-sm text-muted">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full text-[13px]" data-testid="ledger-table">
              <thead className="bg-card-alt text-[11px] uppercase tracking-[0.1em] text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">{t("date")}</th>
                  <th className="px-3 py-2 text-left">{t("document")}</th>
                  <th className="px-3 py-2 text-left">{t("point")}</th>
                  <th className="px-3 py-2 text-right">kWh</th>
                  <th className="px-3 py-2 text-right">{t("net")}</th>
                  <th className="px-3 py-2 text-right">{t("vat")}</th>
                  <th className="px-3 py-2 text-right">{t("gross")}</th>
                  <th className="px-3 py-2 text-left">{t("corrections")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.lines.map((l) => (
                  <tr key={l.receiptId} className="border-t border-hairline">
                    <td className="num px-3 py-2">{l.date.toISOString().slice(0, 10)}</td>
                    <td className="num px-3 py-2">{l.documentNumber}</td>
                    <td className="px-3 py-2">{l.pointName ?? "—"}</td>
                    <td className="num px-3 py-2 text-right">{l.kwh.toFixed(3)}</td>
                    <td className="num px-3 py-2 text-right">{l.net.toFixed(2)}</td>
                    <td className="num px-3 py-2 text-right">{l.vat.toFixed(2)}</td>
                    <td className="num px-3 py-2 text-right">{l.gross.toFixed(2)}</td>
                    <td className="px-3 py-2 align-top">
                      {(() => {
                        const claim = claimByReceipt.get(l.receiptId);
                        if (claim?.status === "OPEN") {
                          return (
                            <span className="text-[12px] text-muted" data-testid="claim-open">
                              {t("claimOpen")}
                            </span>
                          );
                        }
                        return (
                          <div className="space-y-1">
                            {l.correctedReceiptId && (
                              <span className="block text-[12px] text-up" data-testid="line-corrected">
                                {t("claimCorrected")}
                              </span>
                            )}
                            {claim?.status === "REJECTED" && (
                              <span className="block text-[12px] text-muted">
                                {t("claimRejected")}
                              </span>
                            )}
                            <ReturnReceiptForm
                              receiptId={l.receiptId}
                              labels={{
                                open: t("returnToSupport"),
                                reason: t("claimReason"),
                                comment: t("claimComment"),
                                send: t("claimSend"),
                                sent: t("claimSent"),
                                reasonNames: {
                                  REQUISITES: tClaims("reason.REQUISITES"),
                                  VAT: tClaims("reason.VAT"),
                                  SESSION_DETAILS: tClaims("reason.SESSION_DETAILS"),
                                  AMOUNTS: tClaims("reason.AMOUNTS"),
                                  OTHER: tClaims("reason.OTHER"),
                                },
                              }}
                            />
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-card-alt font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={3}>
                    {t("total")}
                  </td>
                  <td className="num px-3 py-2 text-right">{ledger.totals.kwh.toFixed(3)}</td>
                  <td className="num px-3 py-2 text-right">{ledger.totals.net.toFixed(2)}</td>
                  <td className="num px-3 py-2 text-right">{ledger.totals.vat.toFixed(2)}</td>
                  <td className="num px-3 py-2 text-right">
                    {ledger.totals.gross.toFixed(2)} {ledger.currency}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-[16px] font-semibold">{t("claimsTitle")}</h2>
        {claims.length === 0 ? (
          <p className="text-sm text-muted" data-testid="claims-empty">
            {t("claimsEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-hairline text-[13px]" data-testid="operator-claims">
            {claims.map((c) => (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="num">{c.receiptNumber ?? c.receiptId}</span>
                  <span className="text-[12px] text-muted">
                    {tClaims(`reason.${c.reason}`)} · {tClaims(`status.${c.status}`)} ·{" "}
                    {c.createdAt.toISOString().slice(0, 10)}
                  </span>
                </div>
                <p className="mt-1 text-muted">{c.comment}</p>
                {c.resolution && (
                  <p className="mt-1" data-testid="claim-resolution">
                    {c.resolution}
                  </p>
                )}
                {c.issuedReceiptId && (
                  <Link
                    href={`/${locale}/me/wallet/receipts/${c.issuedReceiptId}`}
                    prefetch={false}
                    data-testid="claim-new-version"
                    className="mt-1 inline-block underline hover:text-accent"
                  >
                    {c.issuedReceiptNumber ?? tClaims("newVersion")} →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {access.isOwner || session.user.role === "ADMIN" ? (
        <section className="border-t border-hairline pt-8">
          <RequisitesForm
            operatorId={id}
            initial={{
              legalName: acc?.legalName ?? "",
              regNumber: acc?.regNumber ?? "",
              vatNumber: acc?.vatNumber ?? "",
              addressLine: acc?.addressLine ?? "",
              city: acc?.city ?? "",
              country: acc?.country ?? "",
              vatRatePct: acc?.vatRatePct ? acc.vatRatePct.toString() : "",
              taxNote: acc?.taxNote ?? "",
              datevConsultantNo: acc?.datevConsultantNo ?? "",
              datevClientNo: acc?.datevClientNo ?? "",
              revenueAccount: acc?.revenueAccount ?? "",
              counterAccount: acc?.counterAccount ?? "",
              fiscalYearStart: String(acc?.fiscalYearStart ?? 1),
              bmdClientNo: acc?.bmdClientNo ?? "",
            }}
            labels={{
              requisitesTitle: t("requisitesTitle"),
              requisitesHelp: t("requisitesHelp"),
              legalName: t("legalName"),
              regNumber: t("regNumber"),
              vatNumber: t("vatNumber"),
              addressLine: t("addressLine"),
              city: t("city"),
              country: t("country"),
              vatRatePct: t("vatRatePct"),
              vatRatePlaceholder: t("vatRatePlaceholder"),
              taxNote: t("taxNote"),
              accountsTitle: t("accountsTitle"),
              accountsHelp: t("accountsHelp"),
              datevConsultantNo: t("datevConsultantNo"),
              datevClientNo: t("datevClientNo"),
              revenueAccount: t("revenueAccount"),
              counterAccount: t("counterAccount"),
              fiscalYearStart: t("fiscalYearStart"),
              bmdClientNo: t("bmdClientNo"),
              save: t("save"),
              saved: t("saved"),
            }}
          />
        </section>
      ) : null}
    </div>
  );
}

function recentMonths(now: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
