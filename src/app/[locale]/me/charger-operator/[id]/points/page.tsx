// The operator's points — ТЗ §29, US-24. The list, and the door into the
// wizard.

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NewPointForm } from "@/components/points/new-point-form";

export const dynamic = "force-dynamic";

export default async function PointsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/points`);
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true, claimedById: true },
  });
  if (!operator) notFound();
  if (operator.claimedById !== session.user.id && session.user.role !== "ADMIN") notFound();

  const t = await getTranslations("points");

  const points = await prisma.acceptancePoint.findMany({
    where: { operatorId: id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { connectors: true } } },
  });

  return (
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
      <h1 className="mb-6 text-[28px] font-bold">{t("title")}</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("new")}</h2>
        <NewPointForm
          operatorId={id}
          locale={locale}
          labels={{
            name: t("name"),
            type: t("type"),
            create: t("create"),
            types: {
              CHARGING_STATION: t("kind.CHARGING_STATION"),
              POWERBANK: t("kind.POWERBANK"),
              GENERATION: t("kind.GENERATION"),
              MIXED: t("kind.MIXED"),
            },
          }}
        />
      </section>

      <section>
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("list")}</h2>
        {points.length === 0 ? (
          <p className="text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-hairline text-sm" data-testid="point-list">
            {points.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-3 py-3">
                <Link
                  href={`/${locale}/me/charger-operator/${id}/points/${p.id}`}
                  prefetch={false}
                  className="underline hover:text-accent"
                >
                  {p.name}
                </Link>
                <span className="text-[12px] text-muted">
                  {t(`kind.${p.type}`)} · {t(`status.${p.status}`)} ·{" "}
                  <span className="num">{p._count.connectors}</span> {t("connectors")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
