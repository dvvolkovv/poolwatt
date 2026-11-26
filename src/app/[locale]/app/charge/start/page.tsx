// §54 «клиент видит итоговую цену и все платы до подтверждения», §16.6 —
// экран между сканированием и началом зарядки.

import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ConnectorStatus, PointStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { quoteCharge } from "@/lib/exchange/payment-service";
import { Screen } from "@/components/mobile/screen";
import { ChargeStartForm } from "@/components/mobile/charge-start-form";

export const dynamic = "force-dynamic";

/** §22.9 — сколько кВт·ч берут одним нажатием. */
const AMOUNTS = [10, 20, 50];

export default async function ChargeStartScreen({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ p?: string; c?: string; kwh?: string }>;
}) {
  const { locale } = await params;
  const { p, c, kwh } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/app/charge`);
  }

  if (!p) notFound();

  const point = await prisma.acceptancePoint.findFirst({
    where: { id: p, status: PointStatus.PUBLISHED },
    select: {
      id: true,
      name: true,
      addressLine: true,
      city: true,
      gridZoneId: true,
      connectors: {
        select: { id: true, type: true, powerKw: true, status: true },
        orderBy: { powerKw: "desc" },
      },
    },
  });
  if (!point || !point.gridZoneId) notFound();

  const connector =
    point.connectors.find((x) => x.id === c) ??
    point.connectors.find((x) => x.status === ConnectorStatus.FREE) ??
    point.connectors[0];
  if (!connector) notFound();

  const planned = Number(kwh) > 0 ? Number(kwh) : AMOUNTS[0]!;

  const plan = await quoteCharge({
    userId: session.user.id,
    zoneId: point.gridZoneId,
    requestedKwh: planned,
    pointId: point.id,
    connectorId: connector.id,
  });

  const t = await getTranslations("app.charge");

  return (
    <Screen title={t("title")} back={`/${locale}/app/charge`}>
      <ChargeStartForm
        locale={locale}
        point={{
          id: point.id,
          name: point.name,
          address: [point.addressLine, point.city].filter(Boolean).join(", "),
        }}
        connector={{
          id: connector.id,
          type: String(connector.type),
          powerKw: num(connector.powerKw),
        }}
        amounts={AMOUNTS}
        planned={planned}
        plan={{
          kwhFromGift: plan.kwhFromGift,
          kwhFromBalance: plan.kwhFromBalance,
          kwhFromRoaming: plan.kwhFromRoaming,
          kwhFromMarket: plan.kwhFromMarket,
          kwhFromAggregator: plan.kwhFromAggregator,
          unservedKwh: plan.unservedKwh,
          deliverableKwh: plan.deliverableKwh,
          fee: plan.fee,
          total: plan.total,
          authorizedFiat: plan.authorizedFiat,
          currency: plan.currency,
        }}
        labels={{
          point: t("point"),
          connector: t("connector"),
          amount: t("amount"),
          breakdown: t("breakdown"),
          fromGift: t("fromGift"),
          fromBalance: t("fromBalance"),
          fromRoaming: t("fromRoaming"),
          fromMarket: t("fromMarket"),
          fromAggregator: t("fromAggregator"),
          fee: t("fee"),
          total: t("total"),
          authorized: t("authorized"),
          authorizedHint: t("authorizedHint"),
          start: t("start"),
          noLiquidity: t("noLiquidity"),
        }}
      />
    </Screen>
  );
}
