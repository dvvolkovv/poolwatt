// Где искать зарядки, когда карту ещё не открывали.
//
// До 2026-11-28 область поиска задавала только карта: навигатор был картой с
// боковым списком, и список показывал то, что попало в окно карты. Владелец
// попросил открывать сразу список — «согласно моей локации», — а карту
// сделать отдельным разделом. Значит, область нужно уметь задать тремя
// способами: геопозицией, выбором страны и, по-прежнему, окном карты.

export type Centre = { lat: number; lng: number };
export type BBox = { south: number; west: number; north: number; east: number };

/** Куда смотреть, если человек не сказал ничего: там же, где стояла карта. */
export const DEFAULT_CENTRE: Centre = { lat: 48.15, lng: 17.1 };
export const DEFAULT_RADIUS_KM = 25;

/**
 * Страны в списке. Первыми — зоны, в которых мы работаем (SK, LT, UA), за
 * ними соседи, куда водитель уезжает. Названия стран не переводятся руками:
 * их даёт `Intl.DisplayNames`, то есть они есть на всех 29 языках.
 */
export const COUNTRY_BOXES: Record<string, BBox> = {
  SK: { south: 47.73, west: 16.83, north: 49.61, east: 22.57 },
  LT: { south: 53.89, west: 20.95, north: 56.45, east: 26.84 },
  UA: { south: 44.38, west: 22.14, north: 52.38, east: 40.23 },
  PL: { south: 49.0, west: 14.12, north: 54.84, east: 24.15 },
  CZ: { south: 48.55, west: 12.09, north: 51.06, east: 18.86 },
  AT: { south: 46.37, west: 9.53, north: 49.02, east: 17.16 },
  HU: { south: 45.74, west: 16.11, north: 48.59, east: 22.9 },
  DE: { south: 47.27, west: 5.87, north: 55.06, east: 15.04 },
  LV: { south: 55.67, west: 20.97, north: 58.09, east: 28.24 },
  EE: { south: 57.51, west: 21.76, north: 59.68, east: 28.21 },
};

export const COUNTRY_CODES = Object.keys(COUNTRY_BOXES);

/** Середина страны — туда едет карта, когда страну выбрали. */
export function countryCentre(code: string): Centre | null {
  const box = COUNTRY_BOXES[code];
  if (!box) return null;
  return { lat: (box.south + box.north) / 2, lng: (box.west + box.east) / 2 };
}

/** Название страны на языке страницы. Без словаря: его знает браузер. */
export function countryName(code: string, locale: string): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Расстояние по дуге, в километрах. */
export function distanceKm(a: Centre, b: Centre): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Рамка вокруг точки. Та же арифметика, что на сервере
 * (`bboxFromCenter` в `overpass-chargers.ts`), но здесь она нужна до всякого
 * запроса: список спрашивает станции сам, без карты.
 */
export function bboxAround(centre: Centre, radiusKm: number): BBox {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.max(0.01, Math.cos(rad(centre.lat))));
  return {
    south: centre.lat - dLat,
    west: centre.lng - dLng,
    north: centre.lat + dLat,
    east: centre.lng + dLng,
  };
}

/** Расстояние словами: «800 м», «12 км», «120 км». */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
