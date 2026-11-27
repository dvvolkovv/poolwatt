// "Сообщить о проблеме" — ТЗ §51, US-52 and US-53. The point and its
// connectors are already here; the customer picks a type and sends.

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { ReportForm } from "@/components/work/report-form";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const point = await prisma.acceptancePoint.findUnique({
    where: { id },
    include: { connectors: true, operator: { select: { displayName: true } } },
  });
  if (!point || point.status !== "PUBLISHED") notFound();

  const t = await getTranslations("report");
  const tTickets = await getTranslations("tickets");
  const session = await auth();

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="mx-auto max-w-[640px] px-4 py-10 md:px-8">
        <Link
          href={`/${locale}/c/${id}`}
          prefetch={false}
          className="text-[13px] text-muted underline hover:text-foreground"
        >
          ← {point.name}
        </Link>

        <h1 className="mt-4 text-[28px] font-bold">{t("title")}</h1>
        <p className="mb-6 text-[13px] text-muted">
          {/* §51.2 — the station is filled in, not asked for. */}
          {[point.name, point.addressLine, point.city].filter(Boolean).join(", ")} ·{" "}
          {point.operator.displayName}
        </p>

        <ReportForm
          pointId={point.id}
          locale={locale}
          signedIn={Boolean(session?.user)}
          connectors={point.connectors.map((c) => ({
            id: c.id,
            label: `${c.type} · ${num(c.powerKw)} kW`,
          }))}
          labels={{
            connector: t("connector"),
            anyConnector: t("anyConnector"),
            comment: t("comment"),
            addPhotos: tTickets("addPhotos"),
            follow: tTickets("follow"),
            followHint: tTickets("followHint"),
            send: t("send"),
            sending: t("sending"),
            sent: t("sent"),
            opened: t("opened"),
            alternatives: t("alternatives"),
            noAlternatives: t("noAlternatives"),
            types: {
              NO_START: t("type.NO_START"),
              INTERRUPTED: t("type.INTERRUPTED"),
              DAMAGED_CABLE: t("type.DAMAGED_CABLE"),
              SCREEN_DEAD: t("type.SCREEN_DEAD"),
              BLOCKED: t("type.BLOCKED"),
              WRONG_PRICE: t("type.WRONG_PRICE"),
              OTHER: t("type.OTHER"),
            },
          }}
        />
      </div>
    </main>
  );
}
