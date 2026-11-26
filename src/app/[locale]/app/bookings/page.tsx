// §32, US-30 и US-31 на телефоне: мои брони, продлить и отменить.
//
// Серверные действия те же, что в кабинете (`extendBooking`, `dropBooking`),
// и кнопки те же компоненты: копии логики брони не появляется.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { MAX_EXTENSIONS, readPolicy } from "@/lib/reservations/reservation-service";
import { CancelBookingButton } from "@/components/reservations/cancel-booking-button";
import { ExtendBookingButton } from "@/components/reservations/extend-booking-button";
import { Screen } from "@/components/mobile/screen";

export const dynamic = "force-dynamic";

export default async function MobileBookings({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/app/bookings`);
  }

  const t = await getTranslations("booking");

  const bookings = await prisma.reservation.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      point: { select: { id: true, name: true, city: true } },
      connector: { select: { type: true } },
    },
  });

  // US-31 — предлагать продление или нет, решает политика пункта.
  const extendable = new Set(
    (
      await Promise.all(
        bookings
          .filter((b) => b.status === "ACTIVE" || b.status === "CREATED")
          .map(async (b) =>
            (await readPolicy(b.pointId)).extendAllowed && b.extendCount < MAX_EXTENSIONS
              ? b.id
              : null,
          ),
      )
    ).filter((id): id is string => id !== null),
  );

  return (
    <Screen title={t("mine")} back={`/${locale}/app/more`}>
      {bookings.length === 0 ? (
        <p className="mt-4 text-[14px] text-muted">{t("none")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-hairline" data-testid="booking-list">
          {bookings.map((b) => {
            const live = b.status === "ACTIVE" || b.status === "CREATED";
            return (
              <li key={b.id} className="py-3">
                <Link
                  href={`/${locale}/app/c/${b.point.id}`}
                  prefetch={false}
                  className="text-[15px]"
                >
                  {b.point.name}
                </Link>
                <p className="mt-0.5 text-[12px] text-muted">
                  {b.connector.type} ·{" "}
                  <span className="num" data-testid={`window-${b.id}`}>
                    {b.windowStart.toISOString().slice(11, 16)}–
                    {b.windowEnd.toISOString().slice(11, 16)}
                  </span>{" "}
                  · {t(`status.${b.status}`)}
                  {b.penaltyFiat && (
                    <>
                      {" "}
                      · {t("penalty")}{" "}
                      <span className="num">
                        {num(b.penaltyFiat).toFixed(2)} {b.currency}
                      </span>
                    </>
                  )}
                </p>
                {live && (
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    {extendable.has(b.id) && (
                      <ExtendBookingButton reservationId={b.id} label={t("extend")} />
                    )}
                    <CancelBookingButton reservationId={b.id} label={t("cancel")} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
