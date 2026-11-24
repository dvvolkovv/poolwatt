// One point card under review — ТЗ §29.4, US-24.

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { num, numOrNull } from "@/lib/exchange/decimal";
import { PointDecisionForm } from "@/components/points/point-decision-form";
import { PointMiniCard } from "@/components/points/point-mini-card";

export const dynamic = "force-dynamic";

export default async function AdminPointPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("points");

  const point = await prisma.acceptancePoint.findUnique({
    where: { id },
    include: {
      operator: { select: { displayName: true, email: true, phone: true, websiteUrl: true } },
      gridZone: { select: { code: true, name: true } },
      connectors: true,
      tariffs: { orderBy: { fromMinute: "asc" } },
    },
  });
  if (!point) notFound();

  const first = point.tariffs[0];

  return (
    <div>
      <Link
        href={`/${locale}/admin/points`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {t("adminTitle")}
      </Link>

      <h1 className="mt-4 text-[28px] font-bold">{point.name}</h1>
      <p className="mb-6 text-[13px] text-muted">
        {point.operator.displayName} · {t(`kind.${point.type}`)} · {t(`status.${point.status}`)}
      </p>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <div>
          <dl className="text-sm" data-testid="admin-point-fields">
            <Row label={t("field.addressLine")} value={[point.addressLine, point.city, point.country].filter(Boolean).join(", ")} />
            <Row label={t("field.latitude")} value={point.latitude?.toFixed(5) ?? "—"} />
            <Row label={t("field.longitude")} value={point.longitude?.toFixed(5) ?? "—"} />
            <Row label={t("field.gridZone")} value={point.gridZone ? `${point.gridZone.code} · ${point.gridZone.name}` : "—"} />
            <Row label={t("field.howToFind")} value={point.howToFind ?? "—"} />
            <Row label={t("field.energySource")} value={point.energySource ? t(`source.${point.energySource}`) : "—"} />
            <Row label={t("field.storageKwh")} value={point.storageKwh ? num(point.storageKwh).toFixed(3) : "—"} />
            <Row
              label={t("field.connectors")}
              value={
                point.connectors
                  .map((c) => `${c.type} ×${c.quantity} · ${num(c.powerKw)} kW`)
                  .join("; ") || "—"
              }
            />
            <Row
              label={t("field.paymentMethods")}
              value={point.paymentMethods.map((m) => t(`payment.${m}`)).join(", ") || "—"}
            />
            <Row label={t("field.visibility")} value={t(`visibility.${point.visibility}`)} />
            <Row label={t("field.open24")} value={point.open24 ? "24/7" : (point.holidayNote ?? "—")} />
            <Row label={t("field.ocppVersion")} value={point.ocppVersion ?? "—"} />
            <Row label={t("field.meterId")} value={point.meterId ?? "—"} />
          </dl>

          {point.status === "REVIEW" && (
            <div className="mt-8">
              <PointDecisionForm
                pointId={point.id}
                labels={{
                  approve: t("admin.approve"),
                  reject: t("admin.reject"),
                  note: t("admin.note"),
                  working: t("admin.working"),
                }}
              />
            </div>
          )}
        </div>

        <aside>
          <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-muted">
            {t("preview")}
          </div>
          <PointMiniCard
            point={{
              id: point.id,
              name: point.name,
              operatorName: point.operator.displayName,
              type: point.type,
              city: point.city,
              country: point.country,
              addressLine: point.addressLine,
              latitude: point.latitude,
              longitude: point.longitude,
              energySource: point.energySource,
              open24: point.open24,
              priceFiat: numOrNull(first?.priceFiat ?? null),
              currency: first?.currency ?? "EUR",
              priceTokens: numOrNull(first?.priceTokens ?? null),
              connectors: point.connectors.map((c) => ({
                type: c.type,
                powerKw: num(c.powerKw),
                quantity: c.quantity,
                status: c.status,
              })),
            }}
            locale={locale}
            labels={{
              freeNow: t("mini.freeNow"),
              busy: t("mini.busy"),
              unknown: t("mini.unknown"),
              outOfService: t("mini.outOfService"),
              booked: t("mini.booked"),
              open24: t("mini.open24"),
              route: t("mini.route"),
              details: t("mini.details"),
              noPrice: t("mini.noPrice"),
              connectors: t("mini.connectors"),
              perKwh: t("mini.perKwh"),
            }}
            preview
          />
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6 border-b border-hairline py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
