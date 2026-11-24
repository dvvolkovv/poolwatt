// The point wizard — ТЗ §29, US-24.

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num, numOrNull } from "@/lib/exchange/decimal";
import { missingRequiredFields } from "@/lib/points/point-service";
import { PointWizard, type WizardLabels } from "@/components/points/point-wizard";
import { visiblePointIds } from "@/lib/staff/staff-service";

export const dynamic = "force-dynamic";

export default async function PointWizardPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; pointId: string }>;
}) {
  const { locale, id, pointId } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(
      `/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/points/${pointId}`,
    );
  }

  const point = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    include: {
      operator: { select: { id: true, displayName: true, claimedById: true } },
      connectors: { orderBy: { id: "asc" } },
      tariffs: { orderBy: { fromMinute: "asc" } },
    },
  });
  if (!point || point.operatorId !== id) notFound();
  const isOwner =
    point.operator.claimedById === session.user.id || session.user.role === "ADMIN";
  if (!isOwner) {
    // US-47 — a point outside the employee's scope simply is not there.
    const scope = await visiblePointIds(id, session.user.id);
    if (scope !== null && !scope.includes(pointId)) notFound();
  }

  const t = await getTranslations("points");
  const [zones, missing] = await Promise.all([
    prisma.gridZone.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    missingRequiredFields(pointId),
  ]);

  const labels = {
    ...flatten(t),
    miniCard: {
      freeNow: t("mini.freeNow"),
      busy: t("mini.busy"),
      unknown: t("mini.unknown"),
      outOfService: t("mini.outOfService"),
      open24: t("mini.open24"),
      route: t("mini.route"),
      details: t("mini.details"),
      noPrice: t("mini.noPrice"),
      connectors: t("mini.connectors"),
      perKwh: t("mini.perKwh"),
    },
  } as WizardLabels;

  return (
    <div>
      <Link
        href={`/${locale}/me/charger-operator/${id}/points`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {t("title")}
      </Link>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[28px] font-bold">{point.name}</h1>
        <span
          data-testid="point-status"
          className="rounded-full border border-hairline px-2.5 py-0.5 text-[11px] uppercase tracking-[0.12em] text-muted"
        >
          {t(`status.${point.status}`)}
        </span>
      </div>
      {point.reviewNote && point.status === "DRAFT" && (
        <p className="mt-2 rounded border border-down/40 px-3 py-2 text-[13px] text-down">
          {t("sentBack")}: {point.reviewNote}
        </p>
      )}

      <div className="mt-6">
        <PointWizard
          initial={{
            id: point.id,
            status: point.status,
            type: point.type,
            name: point.name,
            country: point.country ?? "",
            city: point.city ?? "",
            addressLine: point.addressLine ?? "",
            latitude: point.latitude?.toString() ?? "",
            longitude: point.longitude?.toString() ?? "",
            gridZoneId: point.gridZoneId ?? "",
            howToFind: point.howToFind ?? "",
            energySource: point.energySource ?? "",
            storageKwh: point.storageKwh ? num(point.storageKwh).toString() : "",
            connectors: point.connectors.map((c) => ({
              type: c.type,
              powerKw: num(c.powerKw).toString(),
              currentAc: c.currentAc,
              quantity: c.quantity.toString(),
            })),
            tariffs: point.tariffs.map((tr) => ({
              fromMinute: tr.fromMinute.toString(),
              toMinute: tr.toMinute.toString(),
              priceFiat: numOrNull(tr.priceFiat)?.toString() ?? "",
              currency: tr.currency,
              priceTokens: numOrNull(tr.priceTokens)?.toString() ?? "",
              idleFeePerMin: numOrNull(tr.idleFeePerMin)?.toString() ?? "",
              coopDiscount: tr.coopDiscount.toString(),
            })),
            paymentMethods: point.paymentMethods,
            amenities: point.amenities,
            visibility: point.visibility,
            ocppVersion: point.ocppVersion ?? "",
            meterId: point.meterId ?? "",
            open24: point.open24,
            holidayNote: point.holidayNote ?? "",
            description: point.description ?? "",
          }}
          zones={zones}
          missing={missing}
          operatorName={point.operator.displayName}
          locale={locale}
          labels={labels}
        />
      </div>
    </div>
  );
}

/**
 * next-intl resolves on the server, so the client component receives plain
 * strings. The wizard asks for them by dotted key, which is why they arrive
 * flat rather than as a tree.
 */
function flatten(t: (key: string) => string): Record<string, string> {
  const keys = [
    "back", "next", "save", "saved", "preview", "submit", "submitted", "missing", "missingNone",
    "connectionHelp",
    "step.type", "step.address", "step.equipment", "step.tariffs", "step.payment",
    "step.connection", "step.publish",
    "kind.CHARGING_STATION", "kind.POWERBANK", "kind.GENERATION", "kind.MIXED",
    "source.SOLAR", "source.WIND", "source.BIOGAS", "source.HYDRO", "source.GRID", "source.MIXED",
    "payment.TOKEN", "payment.POOLWATT_CARD", "payment.WHITE_LABEL_CARD", "payment.BANK_CARD",
    "payment.QR",
    "amenity.PARKING", "amenity.CAFE", "amenity.TOILET", "amenity.WIFI", "amenity.ACCESSIBLE",
    "amenity.COVERED",
    "visibility.PUBLIC", "visibility.COOP_MEMBERS", "visibility.OWN_CLIENTS",
    "field.name", "field.type", "field.country", "field.city", "field.addressLine",
    "field.latitude", "field.longitude", "field.gridZone", "field.howToFind",
    "field.energySource", "field.storageKwh", "field.connectors", "field.connectorType",
    "field.powerKw", "field.quantity", "field.addConnector", "field.fromMinute",
    "field.toMinute", "field.priceFiat", "field.priceTokens", "field.idleFee",
    "field.coopDiscount", "field.addTariff", "field.paymentMethods", "field.amenities",
    "field.visibility", "field.open24", "field.holidayNote", "field.ocppVersion",
    "field.meterId", "field.description",
    "required.name", "required.address", "required.coordinates", "required.gridZone",
    "required.howToFind", "required.energySource", "required.connectors",
    "required.storageKwh", "required.tariffs", "required.openHours",
    "required.paymentMethods",
  ];
  return Object.fromEntries(keys.map((k) => [k, t(k)]));
}
