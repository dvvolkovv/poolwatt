// QR для печати — US-20 «старт по QR».
//
// Код разъёма должен физически оказаться на станции, иначе сканировать
// нечего. Печатает его тот, кто ставит оборудование: по одной наклейке на
// разъём, с кодом словами под картинкой — на случай мутного стекла и темноты.

import QRCode from "qrcode";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { buildConnectorCode } from "@/lib/exchange/qr-code";
import { visiblePointIds } from "@/lib/staff/staff-service";

export const dynamic = "force-dynamic";

export default async function PointQrPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; pointId: string }>;
}) {
  const { locale, id, pointId } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(
      `/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/points/${pointId}/qr`,
    );
  }

  const point = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    include: {
      operator: { select: { id: true, displayName: true, claimedById: true } },
      connectors: { orderBy: { powerKw: "desc" } },
    },
  });
  if (!point || point.operatorId !== id) notFound();

  const isOwner =
    point.operator.claimedById === session.user.id || session.user.role === "ADMIN";
  if (!isOwner) {
    const scope = await visiblePointIds(id, session.user.id);
    if (scope !== null && !scope.includes(pointId)) notFound();
  }

  const t = await getTranslations("app.charge");

  const stickers = await Promise.all(
    point.connectors.map(async (c) => {
      const code = buildConnectorCode(point.id, c.id);
      return {
        id: c.id,
        type: String(c.type),
        powerKw: num(c.powerKw),
        code,
        svg: await QRCode.toString(code, { type: "svg", margin: 1 }),
      };
    }),
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="print:hidden">
        <Link
          href={`/${locale}/me/charger-operator/${id}/points/${pointId}`}
          className="text-[13px] text-muted underline"
        >
          ‹ {point.name}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">{t("qrTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t("qrHint")}</p>
      </div>

      <div className="mt-8 grid gap-8 sm:grid-cols-2 print:block">
        {stickers.map((s) => (
          <section
            key={s.id}
            className="break-inside-avoid rounded-lg border border-hairline bg-card p-6 text-center print:break-after-page print:border-0 print:bg-white print:text-black"
          >
            <div className="text-sm text-muted print:text-black">{point.name}</div>
            <div className="mt-1 text-lg font-medium">
              {s.type} · <span className="num">{s.powerKw}</span> kW
            </div>
            <div
              className="mx-auto mt-4 w-48 [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: s.svg }}
            />
            <div className="num mt-3 break-all text-[11px] text-muted print:text-black">
              {s.code}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
