export const SUPPORTED_CURRENCIES = ["USD", "EUR", "RUB", "GBP", "BRL"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = "USD";

export type ExchangeRates = Partial<Record<Currency, number>>; // rate vs USD

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  RUB: "₽",
  GBP: "£",
  BRL: "R$",
};

export function formatInCurrency(
  amountUsd: number,
  currency: Currency,
  rates: ExchangeRates,
  options: Intl.NumberFormatOptions = {},
): string {
  const rate = currency === "USD" ? 1 : rates[currency] ?? 1;
  const value = amountUsd * rate;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

export function formatCompactInCurrency(
  amountUsd: number,
  currency: Currency,
  rates: ExchangeRates,
): string {
  const rate = currency === "USD" ? 1 : rates[currency] ?? 1;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(amountUsd * rate);
}
