// Operator view of the nightly registry reconciliation — ТЗ §16.11.
//
// The run itself is a worker job; without this page its findings would live
// only in a log file, which means nobody acts on them.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { ReconcileButton } from "@/components/admin/reconcile-button";
import { readReconciliationRuns } from "@/lib/exchange/reconciliation-service";

export default async function AdminReconciliationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("admin.reconciliation");
  const runs = await readReconciliationRuns(30);
  const stamp = (iso: string | null) =>
    iso ? iso.replace("T", " ").replace(/\..*Z$/, "Z") : "—";

  return (
    <div>
      <h1 className="text-[22px] font-semibold">{t("title")}</h1>
      <p className="mb-4 mt-1 max-w-[90ch] text-[13px] text-muted">{t("intro")}</p>

      <ReconcileButton
        labels={{
          runNow: t("runNow"),
          running: t("running"),
          ok: t("ranOk", { checked: "{checked}" }),
          drift: t("ranDrift", { drifts: "{drifts}" }),
          failed: t("ranFailed", { error: "{error}" }),
        }}
      />

      {runs.length === 0 ? (
        <p className="text-[13px] text-muted">{t("noRuns")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.14em] text-muted">
                <th className="py-2 pr-4">{t("startedAt")}</th>
                <th className="py-2 pr-4">{t("window")}</th>
                <th className="py-2 pr-4">{t("result")}</th>
                <th className="py-2 pr-4">{t("drifts")}</th>
                <th className="py-2">{t("checks")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-hairline align-top">
                  <td className="num py-2 pr-4 whitespace-nowrap">{stamp(run.startedAt)}</td>
                  <td className="num py-2 pr-4 whitespace-nowrap">
                    {stamp(run.windowFrom)} → {stamp(run.windowTo)}
                  </td>
                  <td className="py-2 pr-4">
                    {run.finishedAt == null ? (
                      <span className="text-amber-400">{t("unfinished")}</span>
                    ) : run.ok ? (
                      <span data-testid="run-result">{t("clean")}</span>
                    ) : (
                      <span data-testid="run-result" className="text-red-400">
                        {t("failed")}
                      </span>
                    )}
                  </td>
                  <td className="num py-2 pr-4">{run.driftCount}</td>
                  <td className="py-2">
                    <ul className="space-y-1">
                      {run.checks.map((check) => (
                        <li key={check.name}>
                          <span className="text-muted">
                            {check.name} — {check.checked} {t("checked")}
                          </span>
                          {check.drifts.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {check.drifts.slice(0, 10).map((drift) => (
                                <li key={`${check.name}-${drift.subject}`} className="text-red-400">
                                  <code className="num">{drift.subject}</code>: {t("expected")}{" "}
                                  <span className="num">{drift.expected}</span>, {t("found")}{" "}
                                  <span className="num">{drift.actual}</span>
                                  {drift.note ? ` — ${drift.note}` : ""}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-8 max-w-[90ch] text-[12px] text-muted">{t("externalFeed")}</p>
    </div>
  );
}
