// Operator queue for point cards — ТЗ §9 "Панель оператора", §29.4, US-24.

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { PointStatus } from "@prisma/client";

const STATUSES: PointStatus[] = ["REVIEW", "TEST", "PUBLISHED", "DRAFT", "SUSPENDED"];

export const dynamic = "force-dynamic";

export default async function AdminPointsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const { status: raw } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("points");
  // The queue opens on what needs a decision.
  const status = STATUSES.includes(raw as PointStatus) ? (raw as PointStatus) : "REVIEW";

  const rows = await prisma.acceptancePoint.findMany({
    where: { status },
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    include: {
      operator: { select: { displayName: true } },
      _count: { select: { connectors: true } },
    },
  });

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-6 text-[28px] font-bold">{t("adminTitle")}</h1>

      <nav className="mb-6 flex flex-wrap gap-2 text-[13px]">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/${locale}/admin/points?status=${s}`}
            prefetch={false}
            className={`rounded border px-2.5 py-1 ${
              s === status ? "border-accent text-accent" : "border-hairline text-muted"
            }`}
          >
            {t(`status.${s}`)}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("adminEmpty")}</p>
      ) : (
        <ul className="divide-y divide-hairline text-sm" data-testid="admin-point-queue">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
              <Link
                href={`/${locale}/admin/points/${p.id}`}
                prefetch={false}
                className="underline hover:text-accent"
              >
                {p.name}
              </Link>
              <span className="text-[12px] text-muted">
                {p.operator.displayName} · {t(`kind.${p.type}`)} ·{" "}
                {[p.city, p.country].filter(Boolean).join(", ") || "—"} ·{" "}
                <span className="num">{p._count.connectors}</span> {t("connectors")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
