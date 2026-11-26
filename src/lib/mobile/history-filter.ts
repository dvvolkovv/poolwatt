// §22.3 — фильтр ленты живёт в адресе страницы (`?kind=charge`), как фильтры
// навигатора. «Назад» возвращает к тому же фильтру, а ссылку можно отдать
// поддержке. Мусор в адресе показывает «все», а не ошибку.

import type { WalletHistoryKind } from "@/lib/exchange/wallet-history";

export const HISTORY_FILTERS = [
  "all",
  "buy",
  "sell",
  "charge",
  "transfer",
  "gift",
] as const;

export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export function parseHistoryFilter(raw: string | undefined | null): HistoryFilter {
  return HISTORY_FILTERS.includes(raw as HistoryFilter) ? (raw as HistoryFilter) : "all";
}

/** `undefined` — не фильтровать: именно это ждёт `readWalletHistory`. */
export function kindsForFilter(filter: HistoryFilter): WalletHistoryKind[] | undefined {
  switch (filter) {
    case "all":
      return undefined;
    case "buy":
      return ["BUY"];
    case "sell":
      return ["SELL"];
    case "charge":
      return ["CHARGE"];
    case "transfer":
      return ["TRANSFER_IN", "TRANSFER_OUT"];
    case "gift":
      return ["GIFT"];
  }
}
