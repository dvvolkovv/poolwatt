// §22.7 «Кооператив» и §25 «паи и выплаты» — US-10 и US-21 под телефон.
//
// Читатели и подписи те же, что у страницы в кабинете: ветка `coop` в
// переводах уже полная, и заводить рядом вторую значило бы развести два
// текста об одном и том же. Разметка своя — одна колонка.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  readIncomeForPeriod,
  readMemberShares,
  readMemberVotes,
} from "@/lib/exchange/coop-service";
import { BallotForm } from "@/components/coop/ballot-form";
import { Screen } from "@/components/mobile/screen";

export const dynamic = "force-dynamic";

type Period = "month" | "year" | "all";
const PERIODS: Period[] = ["month", "year", "all"];

/** Окно «доход за период» — те же границы, что в кабинете. */
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
  return { from: new Date(Date.UTC(2000, 0, 1)), to: new Date(Date.UTC(2100, 0, 1)) };
}

const day = (at: Date | null) => (at ? at.toISOString().slice(0, 10) : "—");

export default async function MobileCoop({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ coop?: string; period?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/app/coop`);

  const t = await getTranslations("coop");

  const memberships = await prisma.coopMember.findMany({
    where: { userId: session.user.id },
    orderBy: { joinedAt: "asc" },
    include: { coop: { select: { name: true } } },
  });

  if (memberships.length === 0) {
    return (
      <Screen title={t("eyebrow")} back={`/${locale}/app/more`}>
        <p className="mt-4 text-[15px]" data-testid="coop-none">
          {t("noMemberships")}
        </p>
      </Screen>
    );
  }

  const chosen =
    memberships.find((m) => m.coopId === sp.coop)?.coopId ?? memberships[0].coopId;
  const period: Period = PERIODS.includes(sp.period as Period)
    ? (sp.period as Period)
    : "month";
  const { from, to } = windowFor(period);

  const [shares, income, votes] = await Promise.all([
    readMemberShares(chosen, session.user.id),
    readIncomeForPeriod(chosen, session.user.id, from, to),
    readMemberVotes(chosen, session.user.id),
  ]);
  // Членство могли снять между запросами — ведём себя как будто его нет.
  if (!shares) redirect(`/${locale}/app/coop`);

  const href = (next: { coop?: string; period?: Period }) =>
    `/${locale}/app/coop?coop=${next.coop ?? chosen}&period=${next.period ?? period}`;

  return (
    <Screen title={t("eyebrow")} back={`/${locale}/app/more`}>
      {memberships.length > 1 && (
        <nav className="mt-2 flex flex-wrap gap-1.5" data-testid="coop-list">
          {memberships.map((m) => (
            <Link
              key={m.coopId}
              href={href({ coop: m.coopId })}
              prefetch={false}
              className={`rounded-full border px-3 py-1.5 text-[12px] ${
                m.coopId === chosen ? "border-accent text-accent" : "border-hairline text-muted"
              }`}
            >
              {m.coop.name}
            </Link>
          ))}
        </nav>
      )}

      <h2 className="mt-3 text-[18px] font-semibold">{shares.coopName}</h2>

      <section className="mt-3 grid grid-cols-2 gap-2" data-testid="coop-shares">
        <div className="rounded-lg border border-hairline bg-card px-3 py-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
            {t("shares")}
          </div>
          <div className="num mt-1 text-[24px] font-semibold" data-testid="coop-share-count">
            {shares.shares}
          </div>
        </div>
        <div className="rounded-lg border border-hairline bg-card px-3 py-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
            {t("share")}
          </div>
          <div className="num mt-1 text-[24px] font-semibold">
            {shares.sharePercent == null ? "—" : `${shares.sharePercent.toFixed(2)}%`}
          </div>
        </div>
        <div className="col-span-2 rounded-lg border border-hairline bg-card px-3 py-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
            {t("incomeToDate")}
          </div>
          <div className="num mt-1 text-[22px] font-semibold">
            {shares.incomeToDate.toFixed(2)} {shares.currency}
          </div>
          <div className="mt-1 text-[12px] text-muted">
            {t("pending")}:{" "}
            <span className="num">
              {shares.pendingIncome.toFixed(2)} {shares.currency}
            </span>
          </div>
        </div>
      </section>
      <p className="mt-2 text-[11px] leading-snug text-muted">{t("sharesHelp")}</p>
      <p className="mt-1 text-[12px] text-muted" data-testid="coop-status">
        {t(`status.${shares.status}`)}
      </p>

      <section className="mt-6" data-testid="coop-income">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">
            {t("incomeForPeriod")}
          </h2>
          <nav className="flex gap-1.5">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={href({ period: p })}
                prefetch={false}
                data-testid={`coop-period-${p}`}
                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                  p === period ? "border-accent text-accent" : "border-hairline text-muted"
                }`}
              >
                {t(`period.${p}`)}
              </Link>
            ))}
          </nav>
        </div>
        <div className="num mt-2 text-[22px] font-semibold" data-testid="coop-income-amount">
          {(income?.amount ?? 0).toFixed(2)} {shares.currency}
        </div>
        <div className="text-[12px] text-muted">
          <span className="num">{income?.payouts ?? 0}</span> {t("payoutCount")}
        </div>
      </section>

      <section className="mt-6" data-testid="coop-payouts">
        <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">
          {t("payoutHistory")}
        </h2>
        {shares.payouts.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">{t("noPayouts")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-hairline rounded-lg border border-hairline bg-card">
            {shares.payouts.map((p) => (
              <li
                key={p.payoutId}
                className="flex items-baseline justify-between gap-3 px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="num block text-[13px]">
                    {day(p.periodStart)} — {day(p.periodEnd)}
                  </span>
                  <span className="block text-[11px] text-muted">
                    {p.paidAt ? t("paid") : t("notPaid")}
                  </span>
                </span>
                <span className="num text-[16px]">
                  {p.amount.toFixed(2)} {p.currency}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6" data-testid="coop-votes">
        <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">{t("votes")}</h2>
        {votes.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">{t("noVotes")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {votes.map((v) => (
              <li
                key={v.id}
                className="rounded-lg border border-hairline bg-card px-3 py-3"
                data-testid={`coop-vote-${v.id}`}
              >
                <p className="text-[15px]">{v.question}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {v.status === "OPEN"
                    ? `${t("closesOn")} ${day(v.closesAt)}`
                    : `${t("closedOn")} ${day(v.closedAt)}`}
                </p>

                {v.status === "OPEN" ? (
                  <div className="mt-2">
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
                  </div>
                ) : (
                  <div className="mt-2 text-[13px]">
                    {v.result?.winner && (
                      <p>
                        {t("winner")}: <span className="font-semibold">{v.result.winner}</span>
                      </p>
                    )}
                    <ul className="mt-1 text-[12px] text-muted">
                      {(v.result?.tallies ?? []).map((o) => (
                        <li key={o.option} className="flex justify-between py-0.5">
                          <span>{o.option}</span>
                          <span className="num">{o.votes}</span>
                        </li>
                      ))}
                    </ul>
                    {v.myOption && (
                      <p className="mt-1 text-[12px] text-muted">
                        {t("youVoted")} <span className="font-semibold">{v.myOption}</span>
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] leading-snug text-muted">{t("votesHelp")}</p>
      </section>
    </Screen>
  );
}
