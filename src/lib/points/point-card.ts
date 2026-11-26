// §28 «Карточка пункта: поля» — один читатель на обе карточки, мобильную и
// на монитор. Иначе про §28 в системе будет две правды: карточка на монитор
// показывала меньше половины полей, а дописывать их в неё отдельно от
// телефонной значит заводить второй источник.
//
// Отзывы и история доступности приходят своими функциями: карточка должна
// рисоваться и тогда, когда их нет.

import { prisma } from "@/lib/prisma";
import { num, numOrNull } from "@/lib/exchange/decimal";
import { localMinuteOfDay, tariffAt, zoneKnown } from "./point-tariff";
import { listPointPhotos } from "./point-photos";
import { mayViewPoint, type ViewReason } from "./point-visibility";

export interface CardTariff {
  fromMinute: number;
  toMinute: number;
  label: string | null;
  priceFiat: number | null;
  priceTokens: number | null;
  currency: string;
  idleFeePerMin: number | null;
  coopDiscount: number;
  /** Окно, которое действует сейчас по часам страны пункта. */
  inForce: boolean;
}

export interface CardConnector {
  id: string;
  type: string;
  powerKw: number;
  quantity: number;
  currentAc: boolean;
  status: string;
  statusAt: string | null;
}

/** §28 «Режим работы»: семь дней, по одному окну на день или закрыто. */
export type OpenDay = { from: string; to: string } | null;

export interface PointCardView {
  id: string;
  name: string;
  type: string;
  status: string;
  visibility: string;
  /** Почему эта карточка видна смотрящему — для подписи «закрытая карточка». */
  viewReason: ViewReason;

  // §28 «Владелец»
  owner: {
    operatorId: string;
    displayName: string;
    description: string | null;
    websiteUrl: string | null;
    email: string | null;
    phone: string | null;
    verified: boolean;
    legalName: string | null;
    vatNumber: string | null;
    vatRatePct: number | null;
  };

  // §28 «Адрес и карта»
  country: string | null;
  city: string | null;
  addressLine: string | null;
  latitude: number | null;
  longitude: number | null;
  gridZoneCode: string | null;
  howToFind: string | null;
  photos: { id: string; url: string }[];

  // §28 «Источник энергии»
  energySource: string | null;
  goCertificateRef: string | null;
  green: boolean;

  // §28 «Оборудование»
  connectors: CardConnector[];
  totalPoints: number;
  maxPowerKw: number;
  storageKwh: number | null;

  // §28 «Тарифы»
  tariffs: CardTariff[];
  /** Цена, по которой человек заплатит, если приедет сейчас. */
  priceNow: { fiat: number | null; tokens: number | null; currency: string } | null;
  /** false — окно выбрано по UTC: часового пояса страны мы не знаем. */
  priceZoneKnown: boolean;

  // §28 «Режим работы»
  open24: boolean;
  openHours: OpenDay[] | null;
  holidayNote: string | null;
  closedFrom: string | null;
  closedUntil: string | null;
  /** Пункт закрыт прямо сейчас по полю «временное закрытие». */
  closedNow: boolean;

  // §28 «Способы оплаты», «Удобства»
  paymentMethods: string[];
  amenities: string[];

  // §28 «Подключение»
  ocppVersion: string | null;

  // §28 «Бренд»
  logoUrl: string | null;
  pinColor: string | null;
  description: string | null;

  // §29 — когда оборудование отчитывалось последний раз.
  lastSeenAt: string | null;
  publishedAt: string | null;

  /** §35 — у пункта включена политика брони. */
  bookable: boolean;
}

const GREEN = new Set(["SOLAR", "WIND", "BIOGAS", "HYDRO"]);

function parseOpenHours(value: unknown): OpenDay[] | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  return value.map((day) => {
    if (!day || typeof day !== "object") return null;
    const from = (day as { from?: unknown }).from;
    const to = (day as { to?: unknown }).to;
    return typeof from === "string" && typeof to === "string" ? { from, to } : null;
  });
}

export async function readPointCard(
  pointId: string,
  viewerId: string | null,
  now = new Date(),
): Promise<PointCardView | null> {
  const point = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    include: {
      operator: {
        select: {
          id: true,
          displayName: true,
          description: true,
          websiteUrl: true,
          email: true,
          phone: true,
          claimedById: true,
          accounting: { select: { legalName: true, vatNumber: true, vatRatePct: true } },
        },
      },
      connectors: { orderBy: [{ type: "asc" }, { powerKw: "desc" }] },
      tariffs: { orderBy: { fromMinute: "asc" } },
      gridZone: { select: { code: true } },
      policy: { select: { enabled: true } },
    },
  });
  if (!point) return null;

  const viewReason = await mayViewPoint(
    {
      id: point.id,
      status: point.status,
      visibility: point.visibility,
      operatorId: point.operatorId,
      operatorClaimedById: point.operator.claimedById,
    },
    viewerId,
  );
  if (!viewReason) return null;

  const minute = localMinuteOfDay(now, point.country);
  const inForce = tariffAt(point.tariffs, minute);
  const photos = await listPointPhotos(point.id);

  const connectors: CardConnector[] = point.connectors.map((c) => ({
    id: c.id,
    type: c.type as string,
    powerKw: num(c.powerKw),
    quantity: c.quantity,
    currentAc: c.currentAc,
    status: c.status as string,
    statusAt: c.statusAt ? c.statusAt.toISOString() : null,
  }));

  return {
    id: point.id,
    name: point.name,
    type: point.type as string,
    status: point.status as string,
    visibility: point.visibility as string,
    viewReason,

    owner: {
      operatorId: point.operator.id,
      displayName: point.operator.displayName,
      description: point.operator.description,
      websiteUrl: point.operator.websiteUrl,
      email: point.operator.email,
      phone: point.operator.phone,
      verified: point.operator.claimedById !== null,
      legalName: point.operator.accounting?.legalName ?? null,
      vatNumber: point.operator.accounting?.vatNumber ?? null,
      // §46.7 — ставку вносит сам партнёр; её отсутствие карточка не
      // придумывает, а показывает как «сеть не указала ставку».
      vatRatePct: numOrNull(point.operator.accounting?.vatRatePct ?? null),
    },

    country: point.country,
    city: point.city,
    addressLine: point.addressLine,
    latitude: point.latitude,
    longitude: point.longitude,
    gridZoneCode: point.gridZone?.code ?? null,
    howToFind: point.howToFind,
    photos: photos.map((p) => ({
      id: p.id,
      url: `/api/v1/points/${point.id}/photos/${p.id}`,
    })),

    energySource: point.energySource as string | null,
    goCertificateRef: point.goCertificateRef,
    green: point.energySource ? GREEN.has(point.energySource) : false,

    connectors,
    totalPoints: connectors.reduce((n, c) => n + c.quantity, 0),
    maxPowerKw: connectors.reduce((max, c) => Math.max(max, c.powerKw), 0),
    storageKwh: numOrNull(point.storageKwh),

    tariffs: point.tariffs.map((t) => ({
      fromMinute: t.fromMinute,
      toMinute: t.toMinute,
      label: t.label,
      priceFiat: numOrNull(t.priceFiat),
      priceTokens: numOrNull(t.priceTokens),
      currency: t.currency,
      idleFeePerMin: numOrNull(t.idleFeePerMin),
      coopDiscount: t.coopDiscount,
      inForce: inForce != null && t.fromMinute === inForce.fromMinute && t.toMinute === inForce.toMinute,
    })),
    priceNow: inForce
      ? {
          fiat: numOrNull(inForce.priceFiat),
          tokens: numOrNull(inForce.priceTokens),
          currency: inForce.currency,
        }
      : null,
    priceZoneKnown: zoneKnown(point.country),

    open24: point.open24,
    openHours: parseOpenHours(point.openHours),
    holidayNote: point.holidayNote,
    closedFrom: point.closedFrom ? point.closedFrom.toISOString() : null,
    closedUntil: point.closedUntil ? point.closedUntil.toISOString() : null,
    closedNow:
      point.closedFrom != null &&
      point.closedFrom <= now &&
      (point.closedUntil == null || point.closedUntil >= now),

    paymentMethods: point.paymentMethods,
    amenities: point.amenities,

    ocppVersion: point.ocppVersion,

    logoUrl: point.logoUrl,
    pinColor: point.pinColor,
    description: point.description,

    lastSeenAt: point.lastSeenAt ? point.lastSeenAt.toISOString() : null,
    publishedAt: point.publishedAt ? point.publishedAt.toISOString() : null,

    bookable: point.policy?.enabled === true,
  };
}
