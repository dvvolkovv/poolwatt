// §22.9 «Зарядка и навигатор» — вкладка, с которой водитель начинает зарядку.
//
// Живой сеанс вытесняет всё остальное: человек стоит у станции и смотрит на
// одну цифру. Нет сеанса — QR, код руками и что рядом.

import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  readActiveSession,
  readJustFinishedSession,
  readLastTick,
} from "@/lib/exchange/charge-session";
import { walletChannel } from "@/lib/exchange/realtime";
import { Screen } from "@/components/mobile/screen";
import { ChargeLive } from "@/components/mobile/charge-live";
import { ChargeEntry } from "@/components/mobile/charge-entry";

export const dynamic = "force-dynamic";

export default async function ChargeScreen({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.charge");

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const active = userId ? await readActiveSession(userId) : null;
  const tick = active ? await readLastTick(active.id) : null;
  const finished = userId && !active ? await readJustFinishedSession(userId) : null;
  const receiptId = finished?.paymentId
    ? ((
        await prisma.receipt.findUnique({
          where: { paymentId: finished.paymentId },
          select: { id: true },
        })
      )?.id ?? null)
    : null;

  const entryLabels = {
    scan: t("scan"),
    scanning: t("scanning"),
    manual: t("manual"),
    manualHint: t("manualHint"),
    submit: t("submit"),
    denied: t("denied"),
    notOurs: t("notOurs"),
    nearby: t("nearby"),
    nearbyHelp: t("nearbyHelp"),
    nearbyEmpty: t("nearbyEmpty"),
  };

  return (
    <Screen title={t("title")}>
      {active && userId ? (
        <ChargeLive
          locale={locale}
          initial={{
            id: active.id,
            status: active.status,
            pointId: active.pointId,
            pointName: active.pointName,
            pointAddress: active.pointAddress,
            connectorType: active.connectorType,
            connectorPowerKw: active.connectorPowerKw,
            plannedKwh: active.plannedKwh,
            deliveredKwh: active.deliveredKwh,
            currency: active.currency,
            startedAt: active.startedAt ? active.startedAt.toISOString() : null,
            paymentId: active.paymentId,
          }}
          initialPowerKw={tick?.powerKw ?? null}
          // Цена из согласованного расчёта, а не из прайса пункта: водитель
          // согласился именно на неё (§54).
          pricePerKwh={
            active.quote && active.quote.deliverableKwh > 0
              ? active.quote.total / active.quote.deliverableKwh
              : 0
          }
          channel={walletChannel(userId)}
          labels={{
            live: t("live"),
            delivered: t("delivered"),
            power: t("power"),
            elapsed: t("elapsed"),
            cost: t("cost"),
            waiting: t("waiting"),
            stop: t("stop"),
            stopHint: t("stopHint"),
            report: t("report"),
            done: t("done"),
          }}
        />
      ) : (
        <>
          {finished && (
            <section
              className="mt-2 rounded-lg border border-hairline bg-card px-4 py-3"
              data-testid="charge-finished"
            >
              <div className="text-[12px] uppercase tracking-[0.16em] text-muted">
                {t("done")}
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-[15px]">{finished.pointName}</span>
                <span className="num text-[18px]">
                  {finished.deliveredKwh.toFixed(3)} kWh
                </span>
              </div>
              {receiptId && (
                <Link
                  href={`/${locale}/app/wallet/receipts/${receiptId}`}
                  className="mt-3 inline-block text-[14px] text-accent underline"
                  data-testid="charge-receipt-link"
                >
                  {t("receipt")}
                </Link>
              )}
            </section>
          )}
          {/* §20 — гостю видны пункты и цены; войти его попросит экран
              расчёта, а не пустая вкладка. */}
          <ChargeEntry locale={locale} labels={entryLabels} />
          {!userId && (
            <Link
              href={`/${locale}/login?callbackUrl=/${locale}/app/charge`}
              className="mt-8 block rounded-lg border border-hairline px-4 py-3 text-center text-[14px]"
            >
              {t("signIn")}
            </Link>
          )}
        </>
      )}
    </Screen>
  );
}
