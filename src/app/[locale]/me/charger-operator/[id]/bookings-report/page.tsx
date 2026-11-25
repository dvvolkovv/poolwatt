// US-34 — "Как владелец, хочу видеть статистику броней и неявок: отчёт по
// дням, доход от броней и штрафов."

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readReservationStats } from "@/lib/reservations/reservation-stats";
import { visiblePointIds } from "@/lib/staff/staff-service";

export const dynamic = "force-dynamic";

/** The month being read, as `YYYY-MM`; anything else means this month. */
function monthWindow(raw: string | undefined): { month: string; from: Date; to: Date } {
  const now = new Date();
  const match = /^(\d{4})-(\d{2})$/.exec(raw ?? "");
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : now.getUTCMonth();
  const from = new Date(Date.UTC(year, monthIndex, 1));
  const to = new Date(Date.UTC(year, monthIndex + 1, 1));
  return {
    month: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`,
    from,
    to,
  };
}

/** The previous five months plus this one — enough to look back without a picker. */
function recentMonths(count = 6): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export default async function BookingsReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { locale, id } = await params;
  const { month: rawMonth } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/bookings-report`);
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true, claimedById: true },
  });
  if (!operator) notFound();

  // US-47 — an employee sees only the points they were given.
  const isOwner = operator.claimedById === session.user.id || session.user.role === "ADMIN";
  const scope = isOwner ? null : await visiblePointIds(id, session.user.id);
  if (!isOwner && Array.isArray(scope) && scope.length === 0) notFound();

  const t = await getTranslations("bookingsReport");
  const { month, from, to } = monthWindow(rawMonth);
  const report = await readReservationStats({ operatorId: id, pointIds: scope, from, to });

  const money = (v: number) => `${v.toFixed(2)} ${report.currency}`;

  return (
    <div className="max-w-4xl">
      <Link
        href={`/${locale}/me/charger-operator/${id}`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {operator.displayName}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-2 text-[28px] font-bold">{t("title")}</h1>
      <p className="mb-6 text-sm text-muted">{t("intro")}</p>

      <nav className="mb-8 flex flex-wrap gap-2 text-[13px]">
        {recentMonths().map((m) => (
          <Link
            key={m}
            href={`/${locale}/me/charger-operator/${id}/bookings-report?month=${m}`}
            prefetch={false}
            className={`rounded border px-2.5 py-1 ${
              m === month ? "border-accent text-accent" : "border-hairline text-muted"
            }`}
          >
            <span className="num">{m}</span>
          </Link>
        ))}
      </nav>

      <section className="mb-10" data-testid="bookings-totals">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("totals")}</h2>
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          {[
            [t("booked"), String(report.totals.booked)],
            [t("fulfilled"), String(report.totals.fulfilled)],
            [t("noShow"), String(report.totals.noShow)],
            [
              t("noShowPct"),
              report.totals.noShowPct == null ? "—" : `${report.totals.noShowPct}%`,
            ],
            [t("feeFiat"), money(report.totals.feeFiat)],
            [t("penaltyFiat"), money(report.totals.penaltyFiat)],
            [t("refundFiat"), money(report.totals.refundFiat)],
            [t("netFiat"), money(report.totals.netFiat)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</dt>
              <dd className="num text-[17px] font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("byDay")}</h2>
        {report.days.length === 0 ? (
          <p className="text-sm text-muted" data-testid="bookings-empty">
            {t("empty")}
          </p>
        ) : (
          <table className="w-full text-[13px]" data-testid="bookings-by-day">
            <thead>
              <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.14em] text-muted">
                <th className="py-2">{t("date")}</th>
                <th className="py-2 text-right">{t("booked")}</th>
                <th className="py-2 text-right">{t("fulfilled")}</th>
                <th className="py-2 text-right">{t("noShow")}</th>
                <th className="py-2 text-right">{t("cancelled")}</th>
                <th className="py-2 text-right">{t("feeFiat")}</th>
                <th className="py-2 text-right">{t("penaltyFiat")}</th>
                <th className="py-2 text-right">{t("netFiat")}</th>
              </tr>
            </thead>
            <tbody>
              {report.days.map((d) => (
                <tr key={d.date} className="border-b border-hairline/50">
                  <td className="num py-2">{d.date}</td>
                  <td className="num py-2 text-right">{d.booked}</td>
                  <td className="num py-2 text-right">{d.fulfilled}</td>
                  <td className="num py-2 text-right">{d.noShow}</td>
                  <td className="num py-2 text-right">{d.cancelled}</td>
                  <td className="num py-2 text-right">{d.feeFiat.toFixed(2)}</td>
                  <td className="num py-2 text-right">{d.penaltyFiat.toFixed(2)}</td>
                  <td className="num py-2 text-right">{d.netFiat.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {report.points.length > 0 && (
        <section>
          <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
            {t("byPoint")}
          </h2>
          <ul className="divide-y divide-hairline text-sm" data-testid="bookings-by-point">
            {report.points.map((p) => (
              <li key={p.pointId} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <span>{p.pointName}</span>
                <span className="text-[12px] text-muted">
                  <span className="num">{p.booked}</span> {t("booked").toLowerCase()} ·{" "}
                  <span className="num">{p.noShow}</span> {t("noShow").toLowerCase()} ·{" "}
                  <span className="num">{money(p.netFiat)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
