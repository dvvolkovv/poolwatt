// The day-ahead strip of ТЗ §6 ("заявки на объём на интервал вперёд"): the
// intervals a wholesale buyer can still bid on, what the market shows for
// each, and how much of it is already theirs. Picking one is a plain link —
// the terminal is a server component and re-reads the book for the interval.

import Link from "next/link";
import type { IntervalLadderRow } from "@/lib/exchange/order-service";

export type IntervalLadderLabels = {
  title: string;
  now: string;
  bid: string;
  ask: string;
  mine: string;
};

export function IntervalLadder({
  rows,
  zoneCode,
  intervalMinutes,
  selected,
  currentInterval,
  locale,
  labels,
}: {
  rows: IntervalLadderRow[];
  zoneCode: string;
  intervalMinutes: number;
  selected: Date;
  currentInterval: Date;
  locale: string;
  labels: IntervalLadderLabels;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{labels.title}</h2>
      <ul className="flex gap-2 overflow-x-auto pb-1" data-testid="interval-ladder">
        {rows.map((row) => {
          const isSelected = row.intervalStart.getTime() === selected.getTime();
          const isNow = row.intervalStart.getTime() === currentInterval.getTime();
          return (
            <li key={row.intervalStart.toISOString()} className="shrink-0">
              <Link
                href={`/${locale}/exchange?zone=${zoneCode}&interval=${row.intervalStart.toISOString()}`}
                prefetch={false}
                aria-current={isSelected ? "true" : undefined}
                data-testid={`interval-${row.intervalStart.toISOString()}`}
                className={`block w-[116px] rounded border px-2.5 py-2 ${
                  isSelected
                    ? "border-accent text-foreground"
                    : "border-hairline text-muted hover:text-foreground"
                }`}
              >
                <div className="num text-[13px] text-foreground">
                  {hhmm(row.intervalStart)}–{hhmm(end(row.intervalStart, intervalMinutes))}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted">
                  {isNow ? labels.now : ""}&nbsp;
                </div>
                <dl className="mt-1 space-y-0.5 text-[11px]">
                  <Line label={labels.bid} value={row.bestBid} tone="up" digits={4} />
                  <Line label={labels.ask} value={row.bestAsk} tone="down" digits={4} />
                  <Line
                    label={labels.mine}
                    value={row.myOpenKwh > 0 ? row.myOpenKwh : null}
                    tone="plain"
                    digits={3}
                  />
                </dl>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Line({
  label,
  value,
  tone,
  digits,
}: {
  label: string;
  value: number | null;
  tone: "up" | "down" | "plain";
  digits: number;
}) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-foreground";
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={`num ${value == null ? "text-muted" : color}`}>
        {value == null ? "—" : value.toFixed(digits)}
      </dd>
    </div>
  );
}

function hhmm(d: Date): string {
  return d.toISOString().slice(11, 16);
}

function end(start: Date, minutes: number): Date {
  return new Date(start.getTime() + minutes * 60 * 1000);
}
