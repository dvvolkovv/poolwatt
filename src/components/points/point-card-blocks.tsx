// §28 «Карточка пункта: поля» — разметка блоков, общая для мобильной
// карточки и карточки на монитор. Блоки не знают, где их рисуют: они берут
// `PointCardView` от одного читателя и подписи.

import type { PointCardView } from "@/lib/points/point-card";
import type { ConnectorHistory } from "@/lib/points/availability-history";

/**
 * Подписи. Плоские строки лежат в `t`, словари — рядом: пересечение
 * `Record<string, string>` с вложенными словарями TypeScript считает
 * несовместимым, и правильно считает.
 */
export type PointLabels = {
  t: Record<string, string>;
  weekday: Record<string, string>;
  amenity: Record<string, string>;
  source_: Record<string, string>;
  availability: Record<string, string>;
};

export function Block({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="mt-6" data-testid={testId}>
      <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-2 last:border-0">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-right text-[14px]">{value}</span>
    </div>
  );
}

function minutes(value: number): string {
  const h = Math.floor(value / 60) % 24;
  const m = value % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** §28 «Тарифы»: все окна суток, действующее помечено. */
export function TariffsBlock({
  card,
  labels,
}: {
  card: PointCardView;
  labels: PointLabels;
}) {
  if (card.tariffs.length === 0) return null;
  return (
    <Block title={labels.t.tariffs} testId="card-tariffs">
      <ul className="divide-y divide-hairline rounded-lg border border-hairline bg-card">
        {card.tariffs.map((t, i) => (
          <li key={i} className="px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-muted">
                <span className="num">
                  {minutes(t.fromMinute)}–{minutes(t.toMinute)}
                </span>
                {t.label ? ` · ${t.label}` : ""}
                {t.inForce && (
                  <span className="ml-2 rounded-full bg-up/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-up">
                    {labels.t.inForce}
                  </span>
                )}
              </span>
              <span className="text-right text-[14px]">
                {t.priceFiat != null && (
                  <span className="num">
                    {t.priceFiat.toFixed(3)} {t.currency}
                  </span>
                )}
                {t.priceTokens != null && (
                  <span className="num block text-[12px] text-muted">
                    {t.priceTokens.toFixed(3)} kWh
                  </span>
                )}
              </span>
            </div>
            {(t.idleFeePerMin != null || t.coopDiscount > 0) && (
              <div className="mt-1 text-[12px] text-muted">
                {t.idleFeePerMin != null && (
                  <span>
                    {labels.t.idleFee}:{" "}
                    <span className="num">
                      {t.idleFeePerMin.toFixed(3)} {t.currency}
                    </span>
                  </span>
                )}
                {t.idleFeePerMin != null && t.coopDiscount > 0 && " · "}
                {t.coopDiscount > 0 && (
                  <span>
                    {labels.t.coopDiscount}: <span className="num">{t.coopDiscount}%</span>
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {!card.priceZoneKnown && (
        <p className="mt-2 text-[12px] leading-snug text-muted">{labels.t.priceUtc}</p>
      )}
    </Block>
  );
}

/** §28 «Оборудование». */
export function EquipmentBlock({
  card,
  labels,
}: {
  card: PointCardView;
  labels: PointLabels;
}) {
  return (
    <Block title={labels.t.equipment} testId="card-equipment">
      <ul className="divide-y divide-hairline rounded-lg border border-hairline bg-card">
        {card.connectors.map((c) => (
          <li key={c.id} className="flex items-baseline justify-between gap-3 px-3 py-2.5">
            <span>
              <span className="text-[14px]">{c.type}</span>
              <span className="block text-[12px] text-muted">
                {c.currentAc ? "AC" : "DC"} · {labels.availability[c.status] ?? c.status}
              </span>
            </span>
            <span className="text-right">
              <span className="num text-[15px]">{c.powerKw} kW</span>
              <span className="num block text-[12px] text-muted">× {c.quantity}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2">
        <Row label={labels.t.points} value={<span className="num">{card.totalPoints}</span>} />
        <Row
          label={labels.t.maxPower}
          value={<span className="num">{card.maxPowerKw} kW</span>}
        />
        {card.storageKwh != null && (
          <Row
            label={labels.t.storage}
            value={<span className="num">{card.storageKwh} kWh</span>}
          />
        )}
        {card.ocppVersion && <Row label={labels.t.ocpp} value={card.ocppVersion} />}
        <Row
          label={labels.t.lastSeen}
          value={
            card.lastSeenAt ? (
              <span className="num">{new Date(card.lastSeenAt).toLocaleString()}</span>
            ) : (
              <span className="text-muted">{labels.t.neverSeen}</span>
            )
          }
        />
      </div>
    </Block>
  );
}

/** §28 «Режим работы». */
export function HoursBlock({ card, labels }: { card: PointCardView; labels: PointLabels }) {
  return (
    <Block title={labels.t.hours} testId="card-hours">
      {card.open24 ? (
        <p className="text-[14px]">{labels.t.open24}</p>
      ) : card.openHours ? (
        <div>
          {card.openHours.map((day, i) => (
            <Row
              key={i}
              label={labels.weekday[String(i)] ?? String(i)}
              value={
                day ? (
                  <span className="num">
                    {day.from}–{day.to}
                  </span>
                ) : (
                  <span className="text-muted">{labels.t.closedDay}</span>
                )
              }
            />
          ))}
        </div>
      ) : null}
      {card.holidayNote && (
        <p className="mt-2 text-[13px] text-muted">
          {labels.t.holidays}: {card.holidayNote}
        </p>
      )}
      {card.closedNow && (
        <p className="mt-2 text-[13px] text-down" data-testid="card-closed-now">
          {labels.t.closedNow}
          {card.closedUntil
            ? ` ${labels.t.closedUntil} ${new Date(card.closedUntil).toLocaleDateString()}`
            : ""}
        </p>
      )}
    </Block>
  );
}

/** §28 «Способы оплаты», «Удобства», «Источник энергии». */
export function FactsBlock({ card, labels }: { card: PointCardView; labels: PointLabels }) {
  return (
    <>
      <Block title={labels.t.source} testId="card-source">
        <Row
          label={labels.t.source}
          value={
            card.energySource
              ? (labels.source_[card.energySource] ?? card.energySource)
              : "—"
          }
        />
        {card.goCertificateRef && (
          <Row label={labels.t.goCertificate} value={card.goCertificateRef} />
        )}
      </Block>

      <Block title={labels.t.payment} testId="card-payment">
        <ul className="flex flex-wrap gap-2">
          {card.paymentMethods.map((m) => (
            <li
              key={m}
              className="rounded-full border border-hairline px-3 py-1 text-[12px]"
            >
              {labels.t[`payMethod.${m}`] ?? m}
            </li>
          ))}
        </ul>
      </Block>

      {card.amenities.length > 0 && (
        <Block title={labels.t.amenities} testId="card-amenities">
          <ul className="flex flex-wrap gap-2">
            {card.amenities.map((a) => (
              <li
                key={a}
                className="rounded-full border border-hairline px-3 py-1 text-[12px]"
              >
                {labels.amenity[a] ?? a}
              </li>
            ))}
          </ul>
        </Block>
      )}
    </>
  );
}

/** §28 «Владелец». */
export function OwnerBlock({ card, labels }: { card: PointCardView; labels: PointLabels }) {
  return (
    <Block title={labels.t.owner} testId="card-owner">
      <div className="rounded-lg border border-hairline bg-card px-3 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold">{card.owner.displayName}</span>
          {card.owner.verified && (
            <span className="rounded bg-up/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-up">
              ✓ {labels.t.verified}
            </span>
          )}
        </div>
        {card.owner.description && (
          <p className="mt-1 text-[13px] text-muted">{card.owner.description}</p>
        )}
        <div className="mt-2 flex flex-col gap-1 text-[13px]">
          {card.owner.websiteUrl && (
            <a href={card.owner.websiteUrl} target="_blank" rel="noopener" className="text-accent">
              {card.owner.websiteUrl.replace(/^https?:\/\//, "")}
            </a>
          )}
          {card.owner.email && (
            <a href={`mailto:${card.owner.email}`} className="text-accent">
              {card.owner.email}
            </a>
          )}
          {card.owner.phone && <span className="num text-muted">{card.owner.phone}</span>}
        </div>
        {card.owner.legalName && (
          <div className="mt-2 border-t border-hairline pt-2">
            <Row label={labels.t.legalName} value={card.owner.legalName} />
            {card.owner.vatNumber && (
              <Row label={labels.t.vatNumber} value={<span className="num">{card.owner.vatNumber}</span>} />
            )}
            <Row
              label={labels.t.vatRate}
              value={
                card.owner.vatRatePct != null ? (
                  <span className="num">{card.owner.vatRatePct}%</span>
                ) : (
                  <span className="text-muted">{labels.t.vatMissing}</span>
                )
              }
            />
          </div>
        )}
      </div>
    </Block>
  );
}

/** §27 «история доступности» — семь дней по каждому разъёму. */
export function AvailabilityStrip({
  history,
  labels,
}: {
  history: ConnectorHistory[];
  labels: PointLabels;
}) {
  if (history.length === 0) return null;
  const known = history.some((c) => c.days.some((d) => d.freeShare !== null));

  return (
    <Block title={labels.t.history} testId="card-history">
      {!known ? (
        <p className="text-[13px] text-muted">{labels.t.noHistory}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {history.map((c) => (
            <li key={c.connectorId}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px]">
                  {c.type} · <span className="num">{c.powerKw} kW</span>
                </span>
                {c.lastChange && (
                  <span className="text-[11px] text-muted">
                    {labels.t.lastChange}:{" "}
                    {labels.availability[c.lastChange.status] ?? c.lastChange.status},{" "}
                    <span className="num">
                      {new Date(c.lastChange.at).toLocaleDateString()}
                    </span>
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex h-16 items-end gap-1.5">
                {c.days.map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex h-12 w-full items-end rounded-sm border border-hairline bg-card-alt">
                      {d.freeShare !== null && (
                        <div
                          className="w-full rounded-sm bg-up/70"
                          style={{ height: `${Math.max(2, d.freeShare * 100)}%` }}
                          title={`${d.day}: ${Math.round(d.freeShare * 100)}%`}
                        />
                      )}
                    </div>
                    <span className="num text-[9px] text-muted">{d.day.slice(8)}</span>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-snug text-muted">{labels.t.historyHint}</p>
    </Block>
  );
}

/** §27 «фото» — лента, которую листают пальцем. */
export function PhotoGallery({
  photos,
  labels,
}: {
  photos: { id: string; url: string }[];
  labels: PointLabels;
}) {
  if (photos.length === 0) return null;
  return (
    <div
      className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4"
      data-testid="card-photos"
      aria-label={labels.t.photos}
    >
      {photos.map((p) => (
        /* Фотографию отдаёт маршрут, а не /public: карточка может быть
           закрытой, и кто её видит, решает сервер. */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          key={p.id}
          src={p.url}
          alt=""
          className="h-44 w-[75%] shrink-0 snap-start rounded-xl border border-hairline object-cover"
        />
      ))}
    </div>
  );
}

/** §27 «отзывы» — средняя, число и последние. */
export function ReviewsBlock({
  reviews,
  labels,
}: {
  reviews: {
    average: number | null;
    count: number;
    rows: { id: string; author: string; rating: number; text: string | null; at: string }[];
  };
  labels: PointLabels;
}) {
  return (
    <Block title={labels.t.reviews} testId="card-reviews">
      {reviews.count === 0 ? (
        <p className="text-[13px] text-muted">{labels.t.noReviews}</p>
      ) : (
        <>
          <p className="text-[15px]">
            <span className="num" data-testid="reviews-average">
              ★ {reviews.average?.toFixed(1)}
            </span>{" "}
            <span className="text-[13px] text-muted">
              · <span className="num">{reviews.count}</span>
            </span>
          </p>
          <ul className="mt-2 divide-y divide-hairline">
            {reviews.rows.map((r) => (
              <li key={r.id} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px]">{r.author}</span>
                  <span className="num text-[13px]">★ {r.rating}</span>
                </div>
                {r.text && <p className="mt-1 text-[13px] text-muted">{r.text}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Block>
  );
}
