// §22.3 — лента операций и ряд чипов фильтра. Серверный компонент:
// состояние фильтра держит адрес страницы, а не React.

import Link from "next/link";
import { HISTORY_FILTERS, type HistoryFilter } from "@/lib/mobile/history-filter";
import type { WalletHistoryEntry } from "@/lib/exchange/wallet-history";

export function HistoryList({
  entries,
  filter,
  basePath,
  labels,
  receiptPath,
}: {
  entries: WalletHistoryEntry[];
  filter: HistoryFilter;
  /** Куда ведут чипы: `/ru/app/wallet`. */
  basePath: string;
  labels: {
    empty: string;
    chips: Record<HistoryFilter, string>;
    kinds: Record<string, string>;
  };
  /** Как собрать адрес чека из его id. */
  receiptPath: (id: string) => string;
}) {
  return (
    <div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
        {HISTORY_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? basePath : `${basePath}?kind=${f}`}
            prefetch={false}
            data-chip={f}
            aria-current={f === filter ? "true" : undefined}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] ${
              f === filter ? "border-accent text-accent" : "border-hairline text-muted"
            }`}
          >
            {labels.chips[f]}
          </Link>
        ))}
      </div>

      {entries.length === 0 ? (
        <p className="mt-6 text-[14px] text-muted" data-testid="history-empty">
          {labels.empty}
        </p>
      ) : (
        <ul
          className="mt-3 divide-y divide-hairline rounded-lg border border-hairline bg-card"
          data-testid="history-list"
        >
          {entries.map((e) => {
            const row = (
              <div className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[14px]">{labels.kinds[`kind${e.kind}`]}</div>
                  <div className="truncate text-[12px] text-muted">
                    <span className="num">
                      {e.at.toISOString().slice(0, 16).replace("T", " ")}
                    </span>
                    {e.title && ` · ${e.title}`}
                  </div>
                </div>
                <div className="pl-3 text-right">
                  <div className={`num text-[15px] ${e.kwh >= 0 ? "text-up" : "text-down"}`}>
                    {e.kwh >= 0 ? "+" : "−"}
                    {Math.abs(e.kwh).toFixed(3)} kWh
                  </div>
                  {e.fiat !== 0 && (
                    <div className="num text-[12px] text-muted">
                      {e.fiat >= 0 ? "+" : "−"}
                      {Math.abs(e.fiat).toFixed(2)} {e.currency ?? ""}
                    </div>
                  )}
                </div>
              </div>
            );
            return (
              <li key={e.id} data-kind={e.kind}>
                {e.receiptId ? (
                  <Link
                    href={receiptPath(e.receiptId)}
                    prefetch={false}
                    data-receipt={e.receiptId}
                    className="block"
                  >
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
