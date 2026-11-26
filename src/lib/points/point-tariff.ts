// §28 «Тарифы»: цена по времени суток. Один ответ на вопрос «какая цена у
// пункта сейчас» — для поиска, карточки, мини-карточки и чека. Раньше эта
// логика жила внутри чека, а поиск брал просто первое окно суток, то есть
// в восемь вечера показывал утреннюю цену.
//
// Минуты считаются по времени страны пункта: тариф «ночь с 22:00» — это
// 22:00 там, где стоит станция, а не в UTC. Страны без записи в таблице
// считаются по UTC, и `zoneKnown` даёт карточке это пометить.

const ZONES: Record<string, string> = {
  AT: "Europe/Vienna",
  BE: "Europe/Brussels",
  BG: "Europe/Sofia",
  CH: "Europe/Zurich",
  CZ: "Europe/Prague",
  DE: "Europe/Berlin",
  DK: "Europe/Copenhagen",
  EE: "Europe/Tallinn",
  ES: "Europe/Madrid",
  FI: "Europe/Helsinki",
  FR: "Europe/Paris",
  GR: "Europe/Athens",
  HR: "Europe/Zagreb",
  HU: "Europe/Budapest",
  IE: "Europe/Dublin",
  IT: "Europe/Rome",
  LT: "Europe/Vilnius",
  LV: "Europe/Riga",
  NL: "Europe/Amsterdam",
  NO: "Europe/Oslo",
  PL: "Europe/Warsaw",
  PT: "Europe/Lisbon",
  RO: "Europe/Bucharest",
  SE: "Europe/Stockholm",
  SI: "Europe/Ljubljana",
  SK: "Europe/Bratislava",
  UA: "Europe/Kyiv",
};

export function zoneKnown(country: string | null | undefined): boolean {
  return !!country && country.toUpperCase() in ZONES;
}

/** Минут от местной полуночи, 0…1439. */
export function localMinuteOfDay(at: Date, country: string | null | undefined): number {
  const zone = country ? ZONES[country.toUpperCase()] : undefined;
  if (!zone) return at.getUTCHours() * 60 + at.getUTCMinutes();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // "24:00" — так Intl в режиме hour12:false иногда называет полночь.
  return (hour % 24) * 60 + minute;
}

export interface TariffWindow {
  fromMinute: number;
  toMinute: number;
}

/**
 * Окно, которое действует в эту минуту. Окно с `toMinute <= fromMinute`
 * переходит через полночь («с 22:00 до 06:00»). Если ни одно окно минуту не
 * покрывает — первое, как и делал чек: лучше честная цена из прайса, чем
 * никакая.
 */
export function tariffAt<T extends TariffWindow>(
  tariffs: T[],
  minuteOfDay: number,
): T | null {
  if (tariffs.length === 0) return null;
  const covers = (t: T) =>
    t.toMinute > t.fromMinute
      ? minuteOfDay >= t.fromMinute && minuteOfDay < t.toMinute
      : minuteOfDay >= t.fromMinute || minuteOfDay < t.toMinute;
  return tariffs.find(covers) ?? tariffs[0];
}

/**
 * То же, но от момента и страны пункта. Момент неизвестен — первое окно:
 * это то, что чек делал до появления часовых поясов.
 */
export function tariffAtDate<T extends TariffWindow>(
  tariffs: T[],
  at: Date | null,
  country: string | null | undefined,
): T | null {
  if (tariffs.length === 0) return null;
  if (!at) return tariffs[0];
  return tariffAt(tariffs, localMinuteOfDay(at, country));
}
