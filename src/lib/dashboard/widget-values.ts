// §30 «Виджеты (настраиваемая панель)» — что в плитке написано, отдельно от
// того, как она выглядит.
//
// Пульт на мониторе и экран телефона показывают одни и те же числа, но разной
// разметкой: на мониторе сетка в три колонки, на телефоне одна. Числа поэтому
// живут здесь, а разметка — у каждого своя. Иначе цифра на телефоне однажды
// разойдётся с цифрой на мониторе, и объяснить это будет нечем.

import type { WidgetKey } from "./widgets";
import type { StationOverview } from "@/lib/exchange/station-service";

export interface AssetTokenTotals {
  mintedKwh: number;
  soldKwh: number;
  availableKwh: number;
  storedKwh: number;
  routedKwh: number;
}

/** Плитка с одним числом: всё, кроме графика, аварий, прогноза и железа. */
export interface FigureValue {
  /** Число как текст; «—», когда его нет. Форматирование здесь, чтобы два
   *  экрана не округляли по-разному. */
  value: string;
  unit: string;
}

export interface FigureInput {
  overview: StationOverview;
  tokens: AssetTokenTotals;
  currency: string;
  /** Заряд накопителя в процентах; null — накопителя нет. */
  socPct: number | null;
  /** Цена в зоне; null — оператор её ещё не ставил. */
  spotPrice: number | null;
}

/** Виджеты, у которых своя разметка, а не одно число. */
export const COMPLEX_WIDGETS: ReadonlySet<WidgetKey> = new Set([
  "generationChart",
  "priceForecast",
  "alerts",
  "equipment",
]);

const dash = (unit: string): FigureValue => ({ value: "—", unit });

export function figureValues(input: FigureInput): Partial<Record<WidgetKey, FigureValue>> {
  const { overview, tokens, currency, socPct, spotPrice } = input;
  const kwh = (n: number): FigureValue => ({ value: n.toFixed(3), unit: "kWh" });

  return {
    nowKw:
      overview.nowKw == null
        ? dash("kW")
        : { value: overview.nowKw.toFixed(3), unit: "kW" },
    today: kwh(overview.todayKwh),
    week: kwh(overview.weekKwh),
    month: kwh(overview.monthKwh),
    year: kwh(overview.yearKwh),
    efficiency:
      overview.efficiency == null
        ? dash("%")
        : { value: (overview.efficiency * 100).toFixed(1), unit: "%" },
    revenue: { value: overview.revenue.net.toFixed(2), unit: currency },
    avgPrice:
      overview.revenue.avgPrice == null
        ? dash(`${currency}/kWh`)
        : { value: overview.revenue.avgPrice.toFixed(4), unit: `${currency}/kWh` },
    minted: kwh(tokens.mintedKwh),
    sold: kwh(tokens.soldKwh),
    unsold: kwh(tokens.availableKwh),
    stored: kwh(tokens.storedKwh),
    routed: kwh(tokens.routedKwh),
    storageSoc: socPct == null ? dash("%") : { value: socPct.toFixed(1), unit: "%" },
    zonePrice:
      spotPrice == null
        ? dash(`${currency}/kWh`)
        : { value: spotPrice.toFixed(4), unit: `${currency}/kWh` },
  };
}
