import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getChargerById } from "@/lib/chargers-mock";
import { loadPointAsStation } from "@/lib/points/point-detail";
import { readPolicy } from "@/lib/reservations/reservation-service";
import { BookForm } from "@/components/reservations/book-form";
import { findFreeBookingGift } from "@/lib/marketing/grant-spend";
import { auth } from "@/lib/auth";
import { readFavoriteChargerIds } from "@/lib/favorites";
import { FavoriteButton } from "@/components/favorite-button";
import { MapsDeepLink } from "@/components/maps-deep-link";
import { prisma } from "@/lib/prisma";
import { readLiveContent } from "@/lib/marketing/content-service";
import { ContentSection } from "@/components/marketing/content-block";
import { readPointCard } from "@/lib/points/point-card";
import { readAvailabilityHistory } from "@/lib/points/availability-history";
import { mayReview, readMyReview, readReviews } from "@/lib/points/point-reviews";
import { ReviewForm } from "@/components/points/review-form";
import { submitReview } from "@/app/[locale]/app/c/[id]/actions";
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

const STATUS_COLOR: Record<string, string> = {
  operational: "bg-up",
  planned: "bg-muted",
  temporarily_unavailable: "bg-down",
  removed: "bg-down",
};

export default async function ChargerDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  // A Poolwatt point first — it is a card somebody is answerable for; the
  // mock/OSM catalogue is the fallback.
  const charger = (await loadPointAsStation(id)) ?? getChargerById(id);
  if (!charger) notFound();

  // §28 — те же блоки, что рисует мобильная карточка, от того же читателя.
  // До этого карточка на монитор показывала меньше половины полей §28.
  const sessionForCard = await auth();
  const card = charger.poolwattPointId
    ? await readPointCard(charger.poolwattPointId, sessionForCard?.user?.id ?? null)
    : null;
  const [history, reviews, myReview, canReview] = card
    ? await Promise.all([
        readAvailabilityHistory(card.id),
        readReviews(card.id),
        sessionForCard?.user?.id
          ? readMyReview(sessionForCard.user.id, card.id)
          : Promise.resolve(null),
        sessionForCard?.user?.id
          ? mayReview(sessionForCard.user.id, card.id)
          : Promise.resolve(false),
      ])
    : [[], { average: null, count: 0, rows: [] }, null, false];

  const operator = charger.operator
    ? await prisma.chargerOperator.findFirst({
        where: { aliases: { has: charger.operator } },
        select: {
          id: true, displayName: true, description: true, websiteUrl: true,
          logoUrl: true, email: true, phone: true, claimedById: true,
          pricePerKwh: true, priceCurrency: true, priceUpdatedAt: true,
        },
      })
    : null;
  const isVerified = !!operator?.claimedById;
  const livePrice =
    operator?.pricePerKwh && operator.priceCurrency && operator.priceUpdatedAt
      ? {
          pricePerKwh: operator.pricePerKwh.toString(),
          currency: operator.priceCurrency,
          updatedAt: operator.priceUpdatedAt.toISOString(),
        }
      : null;

  const t = await getTranslations("charger");
  const tPoint = await getTranslations("app.point");
  const tMap = await getTranslations("app.map");
  const cardLabels: PointLabels = {
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
        ].map((k) => [k, tPoint(k)]),
      ) as Record<string, string>),
      "payMethod.TOKEN": tMap("payMethod.TOKEN"),
      "payMethod.POOLWATT_CARD": tMap("payMethod.POOLWATT_CARD"),
      "payMethod.WHITE_LABEL_CARD": tMap("payMethod.WHITE_LABEL_CARD"),
      "payMethod.BANK_CARD": tMap("payMethod.BANK_CARD"),
      "payMethod.QR": tMap("payMethod.QR"),
    },
    weekday: Object.fromEntries(
      ["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, tPoint(`weekday.${d}`)]),
    ),
    amenity: Object.fromEntries(
      ["PARKING", "CAFE", "TOILET", "WIFI", "ACCESSIBLE", "COVERED"].map((a) => [
        a,
        tPoint(`amenity.${a}`),
      ]),
    ),
    source_: Object.fromEntries(
      ["SOLAR", "WIND", "BIOGAS", "HYDRO", "GRID", "MIXED"].map((x) => [
        x,
        tPoint(`source_.${x}`),
      ]),
    ),
    availability: Object.fromEntries(
      ["FREE", "BUSY", "OUT_OF_SERVICE", "BOOKED", "UNKNOWN"].map((a) => [
        a,
        tMap(`availability.${a}`),
      ]),
    ),
  };
  const tBook = await getTranslations("booking");

  // §35 — booking lives on the card of a Poolwatt point; an OpenStreetMap
  // node has no owner to hold a place with.
  const policy = charger.poolwattPointId ? await readPolicy(charger.poolwattPointId) : null;
  // §42 "бесплатная бронь" — read before the form is drawn, so the fee line
  // tells the truth rather than surprising the driver afterwards.
  const freeBookingGift =
    charger.poolwattPointId && sessionForCard?.user?.id
      ? await findFreeBookingGift(sessionForCard.user.id, charger.poolwattPointId)
      : null;
  const bookable =
    policy?.enabled && charger.poolwattPointId
      ? await prisma.pointConnector.findMany({
          where: { pointId: charger.poolwattPointId },
          orderBy: { type: "asc" },
        })
      : [];
  const tOp = await getTranslations("charger.operatorSection");
  const tReport = await getTranslations("report");
  const session = await auth();
  // §41 — the partner's own marketing in the card of their own point. A card
  // that is not ours (an OpenStreetMap pin) has no partner and no content.
  const marketing = charger.poolwattPointId
    ? await readLiveContent(charger.poolwattPointId, "FULL_CARD", session?.user?.id ?? null)
    : [];
  const tMarketing = await getTranslations("marketing");
  const isFavorite = session?.user
    ? (await readFavoriteChargerIds(session.user.id)).has(charger.id)
    : false;

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="max-w-[1000px] mx-auto px-4 md:px-8 py-8 md:py-12">
        <div className="flex items-center justify-between mb-6">
          <Link
            href={`/${locale}/navigator`}
            className="text-sm text-muted hover:text-foreground transition-colors inline-flex items-center gap-1"
          >
            ‹ {t("backToNavigator")}
          </Link>
          <FavoriteButton
            kind="charger"
            id={charger.id}
            initial={isFavorite}
            signedIn={!!session?.user}
            label={{ add: t("favoriteAdd"), remove: t("favoriteRemove") }}
          />
        </div>

        <header className="mb-8">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] mb-3">
            <span
              className={
                "w-2 h-2 rounded-full " + (STATUS_COLOR[charger.status] ?? "bg-muted")
              }
              aria-hidden
            />
            <span className="text-muted">{t(`status.${charger.status}`)}</span>
            <span className="text-muted">·</span>
            <span className="text-muted">{charger.operator}</span>
              {isVerified && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-up/10 text-up border border-up/30">
                  ✓ {tOp("verifiedBadge")}
                </span>
              )}
          </div>
          <h1 className="text-[28px] md:text-[40px] font-bold tracking-[-0.025em] leading-tight">
            {charger.title}
          </h1>
          <p className="mt-3 text-muted text-[14px]">
            {charger.address}, {charger.city}, {charger.country}
          </p>
        </header>

        <div className="mb-10">
          <div className="flex flex-wrap items-center gap-3">
            <MapsDeepLink
              lat={charger.lat}
              lng={charger.lng}
              name={charger.title}
              label={t("buildRoute")}
            />
            {/* §51 — the button is on the card, where the driver already is. */}
            {charger.poolwattPointId && (
              <Link
                href={`/${locale}/c/${charger.poolwattPointId}/report`}
                prefetch={false}
                data-testid="report-problem"
                className="rounded-full border border-hairline px-5 py-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-muted hover:text-foreground"
              >
                {tReport("title")}
              </Link>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted">{t("buildRouteHint")}</p>
        </div>

        <ContentSection
          contents={marketing}
          heading={tMarketing("sectionHeading")}
          pointId={charger.poolwattPointId}
        />

        {policy?.enabled && bookable.length > 0 && (
          <section className="mb-10 max-w-[420px] rounded-lg border border-hairline p-4">
            <BookForm
              freeBookingNetwork={freeBookingGift?.networkName ?? null}
              connectors={bookable.map((c) => ({
                id: c.id,
                label: `${c.type} · ${Number(c.powerKw)} kW`,
                free: c.status === "FREE" || c.status === "UNKNOWN",
              }))}
              policy={{
                feeFiat: policy.feeFiat,
                guaranteeFiat: policy.guaranteeFiat,
                noShowPenaltyFiat: policy.noShowPenaltyFiat,
                waitMinutes: policy.waitMinutes,
                freeCancelMinutes: policy.freeCancelMinutes,
                currency: policy.currency,
              }}
              labels={{
                title: tBook("title"),
                connector: tBook("connector"),
                when: tBook("when"),
                minutes: tBook("minutes"),
                book: tBook("book"),
                booking: tBook("booking"),
                terms: tBook("terms"),
                fee: tBook("fee"),
                guarantee: tBook("guarantee"),
                penalty: tBook("penalty"),
                window: tBook("window"),
                freeCancel: tBook("freeCancel"),
                booked: tBook("booked"),
                noFreeConnector: tBook("noFreeConnector"),
                giftFee: tBook("giftFee"),
                giftFeeNote: tBook("giftFeeNote"),
              }}
            />
          </section>
        )}

        {card ? (
          <>
            <PhotoGallery photos={card.photos} labels={cardLabels} />
            <TariffsBlock card={card} labels={cardLabels} />
            <EquipmentBlock card={card} labels={cardLabels} />
            <HoursBlock card={card} labels={cardLabels} />
            <FactsBlock card={card} labels={cardLabels} />
            <AvailabilityStrip history={history} labels={cardLabels} />
            <ReviewsBlock reviews={reviews} labels={cardLabels} />
            {canReview ? (
              <ReviewForm
                pointId={card.id}
                mine={myReview}
                labels={{
                  myReview: cardLabels.t.myReview,
                  rating: cardLabels.t.rating,
                  reviewText: cardLabels.t.reviewText,
                  send: cardLabels.t.send,
                  sending: cardLabels.t.sending,
                  saved: cardLabels.t.saved,
                }}
                submit={submitReview}
              />
            ) : (
              <p className="mt-2 text-[12px] text-muted" data-testid="review-right">
                {cardLabels.t.reviewRight}
              </p>
            )}
            <OwnerBlock card={card} labels={cardLabels} />
          </>
        ) : (
          <>
            <section className="mb-10">
              <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted mb-4">
                {t("connectorsTitle")}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {charger.connections.map((c, i) => (
                  <div
                    key={i}
                    className="border border-hairline rounded-lg p-4 bg-card flex items-center justify-between"
                  >
                    <div>
                      <div className="text-[15px] font-semibold">{c.connectorType}</div>
                      <div className="text-[12px] text-muted">
                        {c.currentType}
                        {c.voltageV ? ` · ${c.voltageV} V` : ""}
                        {c.ampereA ? ` · ${c.ampereA} A` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[18px] font-bold num">{c.powerKw} kW</div>
                      <div className="text-[11px] text-muted num">× {c.quantity}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-[14px]">
              <Field label={t("totalPoints")} value={String(charger.totalPoints)} />
              <Field label={t("maxPower")} value={`${charger.maxPowerKw} kW`} />
              <Field label={t("usageType")} value={t(`usage.${charger.usageType}`)} />
              {charger.openHours && <Field label={t("openHours")} value={charger.openHours} />}
              <Field
                label={t("priceLabel")}
                value={
                  livePrice
                    ? `${Number(livePrice.pricePerKwh).toFixed(Number(livePrice.pricePerKwh) < 1 ? 3 : 2)} ${livePrice.currency}/kWh`
                    : charger.costInfo ?? t("priceFallback")
                }
                badge={livePrice ? t("priceLive") : null}
                hint={
                  livePrice
                    ? `${t("priceUpdated")} ${new Date(livePrice.updatedAt).toLocaleString(locale)}`
                    : null
                }
              />
              {typeof charger.rating === "number" && (
                <Field label={t("rating")} value={`★ ${charger.rating.toFixed(1)}`} />
              )}
            </section>
          </>
        )}

        <section className="border-t border-hairline pt-6 text-[12px] text-muted">
          <span>{t("lastVerified")}: </span>
          <span className="num text-muted-strong">{charger.lastVerified ?? "—"}</span>
        </section>

        {!card && operator && (
          <section className="mt-8 p-5 bg-card border border-hairline rounded-xl">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">{tOp("title", { name: operator.displayName })}</h2>
            {operator.description && <p className="text-sm text-muted-strong mb-3">{operator.description}</p>}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {operator.websiteUrl && <a href={operator.websiteUrl} target="_blank" rel="noopener" className="text-accent hover:underline">{operator.websiteUrl.replace(/^https?:\/\//, "")}</a>}
              {operator.email && <a href={`mailto:${operator.email}`} className="text-accent hover:underline">{operator.email}</a>}
              {operator.phone && <span className="text-muted">{operator.phone}</span>}
            </div>
            {!isVerified && (
              <Link href={`/${locale}/me/claim/CHARGER_OPERATOR/${operator.id}`}
                className="inline-block mt-4 text-xs uppercase tracking-wider px-3 py-1.5 rounded border border-accent/40 text-accent hover:bg-accent/5">
                {tOp("claimCta")}
              </Link>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  badge,
  hint,
}: {
  label: string;
  value: string;
  badge?: string | null;
  hint?: string | null;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-1 flex items-center gap-2">
        <span>{label}</span>
        {badge && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green/15 text-green normal-case tracking-normal">
            ● {badge}
          </span>
        )}
      </div>
      <div className="text-foreground">{value}</div>
      {hint && <div className="text-[11px] text-muted mt-0.5">{hint}</div>}
    </div>
  );
}
