// The widget catalogue of ТЗ §30 and the rules a saved layout obeys — US-27
// ("добавление, удаление, перестановка, сохранение раскладок").
//
// One list, one validator: the station console and the action that saves a
// layout read the same thing, so a panel can never hold a widget the page
// cannot draw.

/**
 * Only widgets with real data behind them.
 *
 * Three widgets from §30 are deliberately absent: own consumption and feed-in
 * (the meter reports generation only — a second telemetry channel is needed),
 * the weather-based generation forecast (no weather source) and CO₂ saved
 * (needs the grid emission factor of the country, which is an external fact,
 * not arithmetic of ours). They arrive with their sources.
 */
export const WIDGET_KEYS = [
  "nowKw",
  "today",
  "week",
  "month",
  "year",
  "efficiency",
  "revenue",
  "avgPrice",
  "minted",
  "sold",
  "unsold",
  "stored",
  "routed",
  "storageSoc",
  "zonePrice",
  "priceForecast",
  "generationChart",
  "alerts",
  "equipment",
] as const;

export type WidgetKey = (typeof WIDGET_KEYS)[number];

/** One cell, two cells, or the full row of the grid. */
export const WIDGET_SIZES = ["S", "M", "L"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export interface WidgetPlacement {
  key: WidgetKey;
  size: WidgetSize;
}

/** Widgets that say nothing on an asset without a storage. */
const STORAGE_ONLY: ReadonlySet<string> = new Set(["storageSoc"]);

export function isStorageWidget(key: string): boolean {
  return STORAGE_ONLY.has(key);
}

/**
 * What the console shows to a producer who has not set anything up — the
 * panel as it was before US-27, so nothing changes for them.
 */
export const DEFAULT_LAYOUT: WidgetPlacement[] = [
  { key: "nowKw", size: "M" },
  { key: "today", size: "S" },
  { key: "week", size: "S" },
  { key: "month", size: "S" },
  { key: "year", size: "S" },
  { key: "efficiency", size: "S" },
  { key: "revenue", size: "S" },
  { key: "avgPrice", size: "S" },
  { key: "generationChart", size: "L" },
  { key: "minted", size: "S" },
  { key: "sold", size: "S" },
  { key: "unsold", size: "S" },
  { key: "stored", size: "S" },
  { key: "routed", size: "S" },
  { key: "alerts", size: "L" },
  { key: "equipment", size: "L" },
];

export class LayoutError extends Error {}

function isWidgetKey(value: unknown): value is WidgetKey {
  return typeof value === "string" && (WIDGET_KEYS as readonly string[]).includes(value);
}

/**
 * Read a layout out of whatever came from the form or the database.
 *
 * Throws rather than dropping what it does not understand: a layout silently
 * stripped of half its widgets is a worse answer than a refusal, because the
 * producer would save it again and again without learning why.
 */
export function parseLayout(input: unknown): WidgetPlacement[] {
  if (!Array.isArray(input)) throw new LayoutError("A layout is a list of widgets");
  if (input.length === 0) throw new LayoutError("A layout with no widget on it is empty");
  if (input.length > WIDGET_KEYS.length) {
    throw new LayoutError(`A layout cannot hold more than ${WIDGET_KEYS.length} widgets`);
  }

  const seen = new Set<string>();
  return input.map((raw) => {
    const entry = raw as { key?: unknown; size?: unknown };
    if (!isWidgetKey(entry?.key)) {
      throw new LayoutError(`No such widget: ${String(entry?.key)}`);
    }
    const size = entry.size ?? "S";
    if (typeof size !== "string" || !(WIDGET_SIZES as readonly string[]).includes(size)) {
      throw new LayoutError(`No such widget size: ${String(size)}`);
    }
    if (seen.has(entry.key)) {
      throw new LayoutError(`The same widget twice: ${entry.key}`);
    }
    seen.add(entry.key);
    return { key: entry.key, size: size as WidgetSize };
  });
}
