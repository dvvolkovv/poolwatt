// US-10 and US-21 — one member's card: shares, income for a period, the
// history of payouts, and the cooperative's votes.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  readIncomeForPeriod,
  readMemberShares,
  readMemberVotes,
} from "@/lib/exchange/coop-service";
import { BallotForm } from "@/components/coop/ballot-form";

export const dynamic = "force-dynamic";

type Period = "month" | "year" | "all";

/** The window "доход за период" is read over. */
function windowFor(period: Period): { from: Date; to: Date } {
  const now = new Date();
  if (period === "month") {
    return {
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
  }
  if (period === "year") {
    return {
      from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
      to: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)),
    };
  }
  // Everything: a cooperative cannot have been paid before Poolwatt existed.
  return { from: new Date(Date.UTC(2000, 0, 1)), to: new Date(Date.UTC(2100, 0, 1)) };
}

const PERIODS: Period[] = ["month", "year", "all"];

function day(at: Date | null): string {
  return at ? at.toISOString().slice(0, 10) : "—";
}

export default async function CoopMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { locale, id } = await params;
  const { period: rawPeriod } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/coop/${id}`);

  const shares = await readMemberShares(id, session.user.id);
  // A cooperative somebody else is in does not exist here.
  if (!shares) notFound();

  const t = await getTranslations("coop");
  const period = (PERIODS as string[]).includes(rawPeriod ?? "")
    ? (rawPeriod as Period)
    : "month";
  const { from, to } = windowFor(period);

  const [income, votes] = await Promise.all([
    readIncomeForPeriod(id, session.user.id, from, to),
    readMemberVotes(id, session.user.id),
  ]);

  const money = (v: number) => `${v.toFixed(2)} ${shares.currency}`;

  return (
    <div className="max-w-2xl">
      <Link
        href={`/${locale}/me/coop`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {t("listTitle")}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-6 text-[28px] font-bold">{shares.coopName}</h1>

      <section className="mb-10" data-testid="coop-shares">
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">{t("shares")}</dt>
            <dd className="num text-[20px] font-semibold">{shares.shares}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">{t("share")}</dt>
            <dd className="num text-[20px] font-semibold">
              {shares.sharePercent == null ? "—" : `${shares.sharePercent}%`}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">
              {t("incomeToDate")}
            </dt>
            <dd className="num text-[20px] font-semibold">{money(shares.incomeToDate)}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">{t("pending")}</dt>
            <dd className="num text-[20px] font-semibold">{money(shares.pendingIncome)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[12px] text-muted">
          {t(`status.${shares.status}`)} · {t("sharesHelp")}
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("incomeForPeriod")}
        </h2>
        <nav className="mb-3 flex flex-wrap gap-2 text-[13px]">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/${locale}/me/coop/${id}?period=${p}`}
              prefetch={false}
              className={`rounded border px-2.5 py-1 ${
                p === period ? "border-accent text-accent" : "border-hairline text-muted"
              }`}
            >
              {t(`period.${p}`)}
            </Link>
          ))}
        </nav>
        <p className="text-sm" data-testid="coop-period-income">
          <span className="num text-[20px] font-semibold">{money(income?.amount ?? 0)}</span>
          <span className="text-[12px] text-muted">
            {" · "}
            <span className="num">{income?.payouts ?? 0}</span> {t("payoutCount")}
          </span>
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("payoutHistory")}
        </h2>
        {shares.payouts.length === 0 ? (
          <p className="text-sm text-muted">{t("noPayouts")}</p>
        ) : (
          <ul className="divide-y divide-hairline text-sm" data-testid="coop-payouts">
            {shares.payouts.map((p) => (
              <li key={p.payoutId} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <span className="num">
                  {day(p.periodStart)} — {day(p.periodEnd)}
                </span>
                <span className="text-[12px] text-muted">
                  <span className="num">{p.shares}</span> {t("shares")} ·{" "}
                  <span className="num">{money(p.amount)}</span> ·{" "}
                  {p.paidAt ? `${t("paid")} ${day(p.paidAt)}` : t("notPaid")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("votes")}</h2>
        <p className="mb-4 text-[12px] text-muted">{t("votesHelp")}</p>
        {votes.length === 0 ? (
          <p className="text-sm text-muted" data-testid="coop-no-votes">
            {t("noVotes")}
          </p>
        ) : (
          <ul className="space-y-6" data-testid="coop-votes">
            {votes.map((v) => (
              <li key={v.id} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="text-[15px] font-medium">{v.question}</span>
                  <span className="text-[12px] text-muted">
                    {v.status === "CLOSED"
                      ? `${t("closedOn")} ${day(v.closedAt)}`
                      : `${t("closesOn")} ${day(v.closesAt)}`}
                  </span>
                </div>

                {v.status === "CLOSED" && v.result ? (
                  <div data-testid={`result-${v.id}`}>
                    <ul className="text-sm">
                      {v.result.tallies.map((tally) => (
                        <li
                          key={tally.option}
                          className={
                            tally.option === v.result!.winner ? "font-semibold" : "text-muted"
                          }
                        >
                          {tally.option}: <span className="num">{tally.votes}</span>
                          {tally.option === v.result!.winner && ` · ${t("winner")}`}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-[12px] text-muted">
                      <span className="num">{v.result.totalVotes}</span> {t("votesCast")}
                      {v.myOption && ` · ${t("youVoted")} ${v.myOption}`}
                    </p>
                  </div>
                ) : (
                  <BallotForm
                    voteId={v.id}
                    options={v.options}
                    myOption={v.myOption}
                    labels={{
                      cast: t("cast"),
                      change: t("change"),
                      yourVote: t("yourVote"),
                      noScore: t("noScoreYet"),
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
