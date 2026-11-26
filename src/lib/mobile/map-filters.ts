// Девять фильтров §27 живут в адресе страницы — ровно по той же причине, по
// которой они живут в адресе навигатора на монитор: найденный вид должен
// быть ссылкой, которую можно сохранить и отправить.
//
// Семь из девяти опираются на поля, которые есть только у нашего пункта:
// тип, цена в деньгах, цена в токенах, 24/7, способ оплаты, зелёный
// источник, «свободен сейчас». Включён хоть один такой — карта показывает
// только пункты Poolwatt и честно об этом пишет. Фильтровать чужие пины по
// данным, которых у них нет, значит врать о них.

export const POINT_TYPES = [
  "CHARGING_STATION",
  "POWERBANK",
  "GENERATION",
  "MIXED",
] as const;

export const CONNECTORS = [
  "CCS2",
  "CHAdeMO",
  "Type2",
  "Type1",
  "Tesla",
  "GB/T",
  "Schuko",
] as const;

export const POWER_LEVELS = ["ac_slow", "ac_fast", "dc_fast", "dc_ultra"] as const;

export const PAYMENT_METHODS = [
  "TOKEN",
  "POOLWATT_CARD",
  "WHITE_LABEL_CARD",
  "BANK_CARD",
  "QR",
] as const;

export interface MapFilters {
  type: string | null;
  connector: string | null;
  power: string | null;
  freeOnly: boolean;
  maxPriceFiat: number | null;
  maxPriceTokens: number | null;
  open24: boolean;
  paymentMethod: string | null;
  greenOnly: boolean;
}

export const EMPTY_FILTERS: MapFilters = {
  type: null,
  connector: null,
  power: null,
  freeOnly: false,
  maxPriceFiat: null,
  maxPriceTokens: null,
  open24: false,
  paymentMethod: null,
  greenOnly: false,
};

function oneOf(value: string | null, allowed: readonly string[]): string | null {
  return value && allowed.includes(value) ? value : null;
}

function positive(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Только "1" значит «включено»: всё остальное — чужой адрес или опечатка. */
function on(value: string | null): boolean {
  return value === "1";
}

export function parseMapFilters(sp: URLSearchParams): MapFilters {
  return {
    type: oneOf(sp.get("type"), POINT_TYPES),
    connector: oneOf(sp.get("connector"), CONNECTORS),
    power: oneOf(sp.get("power"), POWER_LEVELS),
    freeOnly: on(sp.get("free")),
    maxPriceFiat: positive(sp.get("maxFiat")),
    maxPriceTokens: positive(sp.get("maxTokens")),
    open24: on(sp.get("open24")),
    paymentMethod: oneOf(sp.get("pay"), PAYMENT_METHODS),
    greenOnly: on(sp.get("green")),
  };
}

export function toQuery(f: MapFilters): string {
  const sp = new URLSearchParams();
  if (f.type) sp.set("type", f.type);
  if (f.connector) sp.set("connector", f.connector);
  if (f.power) sp.set("power", f.power);
  if (f.freeOnly) sp.set("free", "1");
  if (f.maxPriceFiat != null) sp.set("maxFiat", String(f.maxPriceFiat));
  if (f.maxPriceTokens != null) sp.set("maxTokens", String(f.maxPriceTokens));
  if (f.open24) sp.set("open24", "1");
  if (f.paymentMethod) sp.set("pay", f.paymentMethod);
  if (f.greenOnly) sp.set("green", "1");
  return sp.toString();
}

/** Сколько фильтров включено — для бейджа на кнопке «Фильтры». */
export function activeCount(f: MapFilters): number {
  return Object.values(f).filter((v) => v !== null && v !== false).length;
}

export function oursOnly(f: MapFilters): boolean {
  return (
    f.type !== null ||
    f.freeOnly ||
    f.maxPriceFiat !== null ||
    f.maxPriceTokens !== null ||
    f.open24 ||
    f.paymentMethod !== null ||
    f.greenOnly
  );
}
