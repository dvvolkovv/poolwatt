// §27 «Полная карточка: всё из раздела 28, отзывы, фото, история
// доступности» — под телефон, одной колонкой.
//
// Блоки те же, что рисует карточка на монитор: один читатель §28, одна
// разметка. Карточка, которую этому человеку видеть не положено, отвечает
// 404, а не «вам нельзя»: чужая карточка не должна подтверждать даже того,
// что она существует.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { readPointCard } from "@/lib/points/point-card";
import { readAvailabilityHistory } from "@/lib/points/availability-history";
import { mayReview, readMyReview, readReviews } from "@/lib/points/point-reviews";
import { readLiveContent } from "@/lib/marketing/content-service";
import { ContentSection } from "@/components/marketing/content-block";
import { RouteSheet } from "@/components/route-sheet";
import { ReviewForm } from "@/components/points/review-form";
import {
  AvailabilityStrip,
  EquipmentBlock,
  FactsBlock,
  HoursBlock,
  OwnerBlock,
  PhotoGallery,
  ReviewsBlock,
  TariffsBlock,
  type PointLabels,
} from "@/components/points/point-card-blocks";
import { submitReview } from "./actions";

export const dynamic = "force-dynamic";

const AVAILABILITY_CLASS: Record<string, string> = {
  FREE: "text-up",
  BUSY: "text-amber-500",
  BOOKED: "text-accent",
  OUT_OF_SERVICE: "text-down",
  UNKNOWN: "text-muted",
};

export default async function MobilePointCard({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const viewerId = session?.user?.id ?? null;

  const card = await readPointCard(id, viewerId);
  if (!card) notFound();

  const t = await getTranslations("app.point");
  const tMap = await getTranslations("app.map");
  const tRoute = await getTranslations("route");
  const tMarketing = await getTranslations("marketing");
  const tReport = await getTranslations("report");

  const [history, reviews, myReview, canReview, marketing] = await Promise.all([
    readAvailabilityHistory(id),
    readReviews(id),
    viewerId ? readMyReview(viewerId, id) : Promise.resolve(null),
    viewerId ? mayReview(viewerId, id) : Promise.resolve(false),
    readLiveContent(id, "FULL_CARD", viewerId),
  ]);

  const labels: PointLabels = {
    t: {
      ...(Object.fromEntries(
      [
        "title", "closedNow", "closedUntil", "notPublished", "coopOnly", "clientsOnly",
        "owner", "verified", "legalName", "vatNumber", "vatRate", "vatMissing",
        "address", "howToFind", "zone", "source", "goCertificate", "equipment",
        "connectors", "points", "maxPower", "storage", "tariffs", "inForce", "idleFee",
        "coopDiscount", "priceUtc", "hours", "open24", "closedDay", "holidays",
        "payment", "amenities", "connection", "ocpp", "lastSeen", "neverSeen", "photos",
        "reviews", "noReviews", "reviewRight", "myReview", "rating", "reviewText",
        "send", "sending", "saved", "history", "historyHint", "lastChange", "noHistory",
        "charge", "book", "report",
        ].map((k) => [k, t(k)]),
      ) as Record<string, string>),
      "payMethod.TOKEN": tMap("payMethod.TOKEN"),
      "payMethod.POOLWATT_CARD": tMap("payMethod.POOLWATT_CARD"),
      "payMethod.WHITE_LABEL_CARD": tMap("payMethod.WHITE_LABEL_CARD"),
      "payMethod.BANK_CARD": tMap("payMethod.BANK_CARD"),
      "payMethod.QR": tMap("payMethod.QR"),
    },
    weekday: Object.fromEntries(
      ["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, t(`weekday.${d}`)]),
    ),
    amenity: Object.fromEntries(
      ["PARKING", "CAFE", "TOILET", "WIFI", "ACCESSIBLE", "COVERED"].map((a) => [
        a,
        t(`amenity.${a}`),
      ]),
    ),
    source_: Object.fromEntries(
      ["SOLAR", "WIND", "BIOGAS", "HYDRO", "GRID", "MIXED"].map((s) => [
        s,
        t(`source_.${s}`),
      ]),
    ),
    availability: Object.fromEntries(
      ["FREE", "BUSY", "OUT_OF_SERVICE", "BOOKED", "UNKNOWN"].map((a) => [
        a,
        tMap(`availability.${a}`),
      ]),
    ),
  };

  // Доступность пункта — лучшее из его разъёмов: есть свободный — свободен.
  const order = ["FREE", "BOOKED", "BUSY", "OUT_OF_SERVICE", "UNKNOWN"];
  const seen = new Set(card.connectors.map((c) => c.status));
  const availability = order.find((s) => seen.has(s)) ?? "UNKNOWN";

  return (
    <div className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28">
      <header className="flex h-12 items-center gap-3">
        <Link
          href={`/${locale}/app/map?open=${card.id}`}
          aria-label={t("title")}
          className="-ml-1 px-1 text-[20px] leading-none text-muted"
        >
          ‹
        </Link>
        <h1 className="truncate text-[18px] font-semibold tracking-[-0.01em]">{card.name}</h1>
      </header>

      <PhotoGallery photos={card.photos} labels={labels} />

      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">
          {tMap(`pointType.${card.type}`)}
          {" · "}
          <span className={AVAILABILITY_CLASS[availability]}>
            {labels.availability[availability]}
          </span>
        </div>
        <p className="mt-1 text-[14px]">
          {[card.addressLine, card.city, card.country].filter(Boolean).join(", ")}
        </p>
        {card.priceNow && (
          <p className="mt-2 text-[22px] font-semibold">
            {card.priceNow.fiat != null && (
              <span className="num">
                {card.priceNow.fiat.toFixed(3)} {card.priceNow.currency}/kWh
              </span>
            )}
            {card.priceNow.tokens != null && (
              <span className="num ml-3 text-[15px] text-muted">
                {card.priceNow.tokens.toFixed(3)} kWh
              </span>
            )}
          </p>
        )}
        {card.howToFind && (
          <p className="mt-2 text-[13px] text-muted">
            {labels.t.howToFind}: {card.howToFind}
          </p>
        )}
        {card.viewReason === "owner" || card.viewReason === "staff" ? (
          card.status !== "PUBLISHED" && (
            <p className="mt-2 text-[12px] text-amber-500" data-testid="card-not-published">
              {labels.t.notPublished}
            </p>
          )
        ) : card.viewReason === "coop" ? (
          <p className="mt-2 text-[12px] text-muted">{labels.t.coopOnly}</p>
        ) : card.viewReason === "client" ? (
          <p className="mt-2 text-[12px] text-muted">{labels.t.clientsOnly}</p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {card.latitude != null && card.longitude != null && (
          <RouteSheet
            lat={card.latitude}
            lng={card.longitude}
            name={card.name}
            labels={{
              route: tRoute("route"),
              openIn: tRoute("openIn"),
              system: tRoute("system"),
              google: tRoute("google"),
              apple: tRoute("apple"),
              waze: tRoute("waze"),
              cancel: tRoute("cancel"),
            }}
            className="rounded-full bg-accent px-5 py-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-accent-foreground"
          />
        )}
        <Link
          href={`/${locale}/app/charge/start?p=${card.id}`}
          prefetch={false}
          data-testid="card-charge"
          className="rounded-full border border-hairline px-5 py-3 text-[13px] font-semibold uppercase tracking-[0.18em]"
        >
          {labels.t.charge}
        </Link>
        {card.bookable && (
          <Link
            href={`/${locale}/c/${card.id}`}
            prefetch={false}
            data-testid="card-book"
            className="rounded-full border border-hairline px-5 py-3 text-[13px] uppercase tracking-[0.18em] text-muted"
          >
            {labels.t.book}
          </Link>
        )}
        <Link
          href={`/${locale}/c/${card.id}/report`}
          prefetch={false}
          data-testid="card-report"
          className="rounded-full border border-hairline px-5 py-3 text-[13px] uppercase tracking-[0.18em] text-muted"
        >
          {tReport("title")}
        </Link>
      </div>

      {/* §41 — реклама партнёра в карточке его собственного пункта. */}
      <ContentSection
        contents={marketing}
        heading={tMarketing("sectionHeading")}
        pointId={card.id}
      />

      <TariffsBlock card={card} labels={labels} />
      <EquipmentBlock card={card} labels={labels} />
      <HoursBlock card={card} labels={labels} />
      <FactsBlock card={card} labels={labels} />
      <AvailabilityStrip history={history} labels={labels} />

      <ReviewsBlock reviews={reviews} labels={labels} />
      {canReview ? (
        <ReviewForm
          pointId={card.id}
          mine={myReview}
          labels={{
            myReview: labels.t.myReview,
            rating: labels.t.rating,
            reviewText: labels.t.reviewText,
            send: labels.t.send,
            sending: labels.t.sending,
            saved: labels.t.saved,
          }}
          submit={submitReview}
        />
      ) : (
        <p className="mt-2 text-[12px] text-muted" data-testid="review-right">
          {labels.t.reviewRight}
        </p>
      )}

      <OwnerBlock card={card} labels={labels} />
    </div>
  );
}
