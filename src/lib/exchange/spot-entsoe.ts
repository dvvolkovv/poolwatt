// The zone's spot reference — ТЗ §6 ("Ориентир цены: спотовая цена внешнего
// рынка зоны") and §16.5, which measures the anti-manipulation corridor from
// it.
//
// Source: publication A44 "Day-ahead prices" of the ENTSO-E Transparency
// Platform. It answers XML, flat enough to read without a parser dependency,
// and always in EUR per MWh; Poolwatt prices energy per kWh, so everything
// here converts on the way in.
//
// Needs `ENTSOE_TOKEN`, which only the owner can obtain (see gates.ts). Until
// then this module is exercised only by the recorded documents in
// `__fixtures__`, which is also why parsing lives apart from fetching.

import { roundPrice } from "./precision";

export const ENTSOE_ENDPOINT = "https://web-api.tp.entsoe.eu/api";

export class SpotFeedError extends Error {}

/** The platform's own time format: UTC, minutes, no separators. */
function platformTime(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

export function entsoeRequestUrl(args: {
  areaCode: string;
  from: Date;
  to: Date;
  token: string;
}): string {
  const url = new URL(ENTSOE_ENDPOINT);
  url.searchParams.set("documentType", "A44");
  // A price is a property of one bidding zone, so both domains are the zone.
  url.searchParams.set("in_Domain", args.areaCode);
  url.searchParams.set("out_Domain", args.areaCode);
  url.searchParams.set("periodStart", platformTime(args.from));
  url.searchParams.set("periodEnd", platformTime(args.to));
  url.searchParams.set("securityToken", args.token);
  return url.toString();
}

export interface SpotPoint {
  intervalStart: Date;
  resolutionMinutes: number;
  /** EUR per kWh, rounded to the four decimals the registry stores. */
  pricePerKwh: number;
}

export interface SpotSeries {
  currency: string;
  points: SpotPoint[];
}

const RESOLUTIONS: Record<string, number> = {
  PT15M: 15,
  PT30M: 30,
  PT60M: 60,
  PT1H: 60,
};

function tagValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(xml);
  return match ? match[1].trim() : null;
}

function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/**
 * Read a recorded or live A44 document.
 *
 * Positions are one-based offsets of `resolution` from the period start. A
 * missing position is not an error: curve type A03 omits a point whose price
 * equals the previous one, so the previous price is carried forward. That is
 * also the safe reading of a gap in an A01 curve — a hole in the corridor
 * reference would switch the §16.5 guard off for that interval.
 */
export function parseDayAheadPrices(xml: string): SpotSeries {
  if (/<Acknowledgement_MarketDocument/.test(xml)) {
    const reason = tagValue(xml, "text") ?? tagValue(xml, "code") ?? "no reason given";
    throw new SpotFeedError(`ENTSO-E returned no prices: ${reason}`);
  }
  if (!/<Publication_MarketDocument/.test(xml)) {
    throw new SpotFeedError("Response is not an ENTSO-E publication document");
  }

  const series = blocks(xml, "TimeSeries");
  if (series.length === 0) throw new SpotFeedError("Document carries no time series");

  let currency = "EUR";
  const points: SpotPoint[] = [];

  for (const ts of series) {
    currency = tagValue(ts, "currency_Unit\\.name") ?? currency;
    const unit = tagValue(ts, "price_Measure_Unit\\.name") ?? "MWH";
    if (unit.toUpperCase() !== "MWH") {
      throw new SpotFeedError(`Unsupported price unit ${unit}; only MWH is understood`);
    }

    for (const period of blocks(ts, "Period")) {
      const resolution = tagValue(period, "resolution") ?? "";
      const minutes = RESOLUTIONS[resolution.toUpperCase()];
      if (!minutes) {
        throw new SpotFeedError(`Unsupported resolution ${resolution || "(none)"}`);
      }
      const startText = tagValue(period, "start");
      if (!startText) throw new SpotFeedError("Period has no start");
      const periodStart = new Date(startText);
      if (Number.isNaN(periodStart.getTime())) {
        throw new SpotFeedError(`Period start ${startText} is not a time`);
      }
      const endText = tagValue(period, "end");
      const periodEnd = endText ? new Date(endText) : null;

      const raw: { position: number; pricePerMwh: number }[] = [];
      for (const point of blocks(period, "Point")) {
        const position = Number(tagValue(point, "position"));
        const price = Number(tagValue(point, "price\\.amount"));
        if (!Number.isInteger(position) || position < 1 || !Number.isFinite(price)) {
          throw new SpotFeedError("Point has no usable position or price");
        }
        raw.push({ position, pricePerMwh: price });
      }
      if (raw.length === 0) continue;
      raw.sort((a, b) => a.position - b.position);

      // How many slots the period holds: its own length when stated, else the
      // last position published.
      const slots =
        periodEnd && !Number.isNaN(periodEnd.getTime())
          ? Math.round((periodEnd.getTime() - periodStart.getTime()) / (minutes * 60_000))
          : raw[raw.length - 1].position;

      let current = raw[0].pricePerMwh;
      let next = 0;
      for (let position = 1; position <= slots; position += 1) {
        while (next < raw.length && raw[next].position === position) {
          current = raw[next].pricePerMwh;
          next += 1;
        }
        points.push({
          intervalStart: new Date(periodStart.getTime() + (position - 1) * minutes * 60_000),
          resolutionMinutes: minutes,
          pricePerKwh: roundPrice(current / 1000),
        });
      }
    }
  }

  if (points.length === 0) throw new SpotFeedError("Document carries no price points");
  points.sort((a, b) => a.intervalStart.getTime() - b.intervalStart.getTime());
  return { currency, points };
}

/** Fetch and parse. Separate from the parser so tests never need the network. */
export async function fetchDayAheadPrices(args: {
  areaCode: string;
  from: Date;
  to: Date;
  token: string;
  signal?: AbortSignal;
}): Promise<SpotSeries> {
  const response = await fetch(entsoeRequestUrl(args), {
    headers: { accept: "application/xml" },
    signal: args.signal,
  });
  const body = await response.text();
  if (!response.ok) {
    throw new SpotFeedError(
      `ENTSO-E answered ${response.status}: ${body.slice(0, 200).replace(/\s+/g, " ")}`,
    );
  }
  return parseDayAheadPrices(body);
}
