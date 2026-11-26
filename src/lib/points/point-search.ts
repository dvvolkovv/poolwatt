// Finding a point — ТЗ §27 (the navigator's filters), US-23.
//
// Only cards a driver is allowed to see come back: published, and public.
// Availability is a promise, so a connector whose occupancy we have never
// heard does not count as free — the driver asked for free, not for "maybe".

import {
  ConnectorStatus,
  PointEnergySource,
  PointStatus,
  PointVisibility,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num, numOrNull } from "@/lib/exchange/decimal";
import { localMinuteOfDay, tariffAt, zoneKnown } from "./point-tariff";

// §27 «зелёный источник». Сеть и смешанный не зелёные: в смешанном есть
// сеть, и обещать зелёное мы не можем.
const GREEN = [
  PointEnergySource.SOLAR,
  PointEnergySource.WIND,
  PointEnergySource.BIOGAS,
  PointEnergySource.HYDRO,
];

export interface SearchBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface SearchArgs {
  bbox: SearchBox;
  connector?: string | null;
  minPowerKw?: number | null;
  freeOnly?: boolean;
  /** §27 «тип пункта». */
  type?: string | null;
  /** §27 «цена за кВт·ч в деньгах» — верхняя граница. */
  maxPriceFiat?: number | null;
  /** §27 «цена за кВт·ч в токенах» — верхняя граница. */
  maxPriceTokens?: number | null;
  /** §27 «работает 24/7». */
  open24?: boolean;
  /** §27 «принимает white label карты» и прочие способы оплаты §28. */
  paymentMethod?: string | null;
  /** §27 «зелёный источник»: солнце, ветер, биогаз, гидро. */
  greenOnly?: boolean;
  /** Sorts by distance and fills `distanceM`. */
  near?: { lat: number; lng: number } | null;
  limit?: number;
  /** Подстановка минуты суток для тестов; обычно берётся из страны пункта. */
  nowMinuteOfDay?: number | null;
}

export interface FoundPoint {
  id: string;
  name: string;
  operatorName: string | null;
  type: string;
  city: string | null;
  country: string | null;
  addressLine: string | null;
  latitude: number;
  longitude: number;
  energySource: string | null;
  open24: boolean;
  priceFiat: number | null;
  priceTokens: number | null;
  currency: string;
  idleFeePerMin: number | null;
  /** §28 «Способы оплаты» — на них стоит фильтр §27. */
  paymentMethods: string[];
  /** false, когда окно тарифа выбрано по UTC: часового пояса страны нет. */
  priceZoneKnown: boolean;
  connectors: { type: string; powerKw: number; quantity: number; status: ConnectorStatus }[];
  distanceM: number | null;
}

const DEFAULT_LIMIT = 300;

export async function searchPoints(args: SearchArgs): Promise<FoundPoint[]> {
  const rows = await prisma.acceptancePoint.findMany({
    where: {
      status: PointStatus.PUBLISHED,
      visibility: PointVisibility.PUBLIC,
      latitude: { gte: args.bbox.south, lte: args.bbox.north },
      longitude: { gte: args.bbox.west, lte: args.bbox.east },
      ...(args.type ? { type: args.type as never } : {}),
      ...(args.open24 ? { open24: true } : {}),
      ...(args.paymentMethod ? { paymentMethods: { has: args.paymentMethod } } : {}),
      ...(args.greenOnly ? { energySource: { in: GREEN } } : {}),
      ...(args.connector || args.minPowerKw || args.freeOnly
        ? {
            connectors: {
              some: {
                ...(args.connector ? { type: args.connector as never } : {}),
                ...(args.minPowerKw ? { powerKw: { gte: args.minPowerKw } } : {}),
                ...(args.freeOnly ? { status: ConnectorStatus.FREE } : {}),
              },
            },
          }
        : {}),
    },
    take: args.limit ?? DEFAULT_LIMIT,
    include: {
      operator: { select: { displayName: true } },
      connectors: true,
      // Все окна суток: нужное выбирает `tariffAt`, а не `take: 1`.
      tariffs: { orderBy: { fromMinute: "asc" } },
    },
  });

  const found = rows
    .filter((p) => p.latitude != null && p.longitude != null)
    .map((p) => {
      const minute = args.nowMinuteOfDay ?? localMinuteOfDay(new Date(), p.country);
      const tariff = tariffAt(p.tariffs, minute);
      const distanceM = args.near
        ? haversineMetres(args.near.lat, args.near.lng, p.latitude!, p.longitude!)
        : null;
      return {
        id: p.id,
        name: p.name,
        operatorName: p.operator.displayName,
        type: p.type,
        city: p.city,
        country: p.country,
        addressLine: p.addressLine,
        latitude: p.latitude!,
        longitude: p.longitude!,
        energySource: p.energySource,
        open24: p.open24,
        priceFiat: numOrNull(tariff?.priceFiat ?? null),
        priceTokens: numOrNull(tariff?.priceTokens ?? null),
        currency: tariff?.currency ?? "EUR",
        idleFeePerMin: numOrNull(tariff?.idleFeePerMin ?? null),
        paymentMethods: p.paymentMethods,
        priceZoneKnown: args.nowMinuteOfDay != null ? true : zoneKnown(p.country),
        connectors: p.connectors.map((c) => ({
          type: c.type as string,
          powerKw: num(c.powerKw),
          quantity: c.quantity,
          status: c.status,
        })),
        distanceM,
      };
    });

  // Цену нельзя отфильтровать в SQL: окно суток выбирается в коде. Пункт без
  // цены фильтр по цене не проходит — «дешевле двадцати центов» это
  // обещание, а цены мы о нём не знаем.
  let result = found;
  if (args.maxPriceFiat != null) {
    const ceiling = args.maxPriceFiat;
    result = result.filter((p) => p.priceFiat != null && p.priceFiat <= ceiling);
  }
  if (args.maxPriceTokens != null) {
    const ceiling = args.maxPriceTokens;
    result = result.filter((p) => p.priceTokens != null && p.priceTokens <= ceiling);
  }

  if (args.near) result.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
  return result;
}

/** Great-circle distance in metres — enough for "which is nearer". */
function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** How far around a broken point we look, and how many we offer. */
const OFFER_BOX_DEGREES = 0.5;
const OFFER_LIMIT = 3;

/**
 * US-53 and US-55 — "сразу увидеть ближайшую рабочую станцию". The same
 * search the navigator uses, from where the driver was going, with the plug
 * they came with and a connector that is actually free.
 */
export async function nearestWorkingPoints(
  pointId: string,
  connectorType: string | null,
): Promise<FoundPoint[]> {
  const point = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    select: { latitude: true, longitude: true },
  });
  // Without coordinates there is no "nearest"; saying nothing beats guessing.
  if (!point?.latitude || !point.longitude) return [];

  const found = await searchPoints({
    bbox: {
      south: point.latitude - OFFER_BOX_DEGREES,
      north: point.latitude + OFFER_BOX_DEGREES,
      west: point.longitude - OFFER_BOX_DEGREES,
      east: point.longitude + OFFER_BOX_DEGREES,
    },
    connector: connectorType,
    freeOnly: true,
    near: { lat: point.latitude, lng: point.longitude },
  });

  return found.filter((p) => p.id !== pointId).slice(0, OFFER_LIMIT);
}
