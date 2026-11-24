"use client";

// US-07 "покупка кВт·ч впрок" — one click at the market price, or a custom
// amount with an optional limit price to wait for a better one.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitBuyAhead, type OrderActionResult } from "@/app/[locale]/exchange/actions";
import { newRequestKey } from "@/lib/request-key";

type Quote = { zoneId: string; amountKwh: number; estimate: number | null };

type Props = {
  zones: { id: string; code: string; currency: string }[];
  defaultZoneId: string;
  /** Cost of each quick amount per zone, priced on the server off the book. */
  quotes: Quote[];
  labels: {
    amount: string;
    limitPrice: string;
    buy: string;
    quickBuy: string;
    noLiquidity: string;
  };
};

export function BuyAheadForm({ zones, defaultZoneId, quotes, labels }: Props) {
  const [zoneId, setZoneId] = useState(defaultZoneId);
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [result, setResult] = useState<OrderActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // §15 — one key per purchase intent, so a double click buys once.
  const requestKey = useRef(newRequestKey());

  const amountNum = Number(amount.replace(",", "."));
  const limitNum = limitPrice.trim() === "" ? null : Number(limitPrice.replace(",", "."));
  const zone = zones.find((z) => z.id === zoneId);
  const zoneQuotes = quotes.filter((q) => q.zoneId === zoneId);

  function buy(amountKwh: number, limit: number | null) {
    setResult(null);
    startTransition(async () => {
      const r = await submitBuyAhead({
        zoneId,
        amountKwh,
        limitPrice: limit,
        idempotencyKey: requestKey.current,
      });
      setResult(r);
      if (r.ok) {
        requestKey.current = newRequestKey();
        setAmount("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <select
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
          aria-label="zone"
          className="border border-hairline rounded px-2 py-1.5 bg-transparent text-sm"
        >
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.code}
            </option>
          ))}
        </select>
        <span className="self-center text-[12px] text-muted">{labels.quickBuy}</span>
      </div>

      {/* One click buys: the amount is the button, there is no second step. */}
      <div className="grid grid-cols-3 gap-2" data-testid="quick-buy">
        {zoneQuotes.map((q) => (
          <button
            key={q.amountKwh}
            type="button"
            disabled={pending || q.estimate == null}
            onClick={() => buy(q.amountKwh, null)}
            data-testid={`quick-buy-${q.amountKwh}`}
            className="rounded border border-hairline px-2 py-2 text-sm hover:border-accent disabled:opacity-50"
          >
            <span className="num block">{q.amountKwh} kWh</span>
            <span className="block text-[11px] text-muted num">
              {q.estimate == null
                ? labels.noLiquidity
                : `≈ ${q.estimate.toFixed(2)} ${zone?.currency ?? ""}`}
            </span>
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          buy(amountNum, limitNum);
        }}
        className="space-y-3"
      >
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={labels.amount}
          aria-label={labels.amount}
          className="w-full border border-hairline rounded px-2 py-1.5 bg-transparent num"
        />

        <input
          inputMode="decimal"
          value={limitPrice}
          onChange={(e) => setLimitPrice(e.target.value)}
          placeholder={`${labels.limitPrice}${zone ? `, ${zone.currency}/kWh` : ""}`}
          aria-label={labels.limitPrice}
          className="w-full border border-hairline rounded px-2 py-1.5 bg-transparent num"
        />

        <button
          type="submit"
          disabled={pending || !(amountNum > 0)}
          className="w-full py-2 rounded bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
        >
          {pending ? "…" : labels.buy}
        </button>
      </form>

      {result && !result.ok && <p className="text-[12px] text-down">{result.formError}</p>}
      {result?.ok && (
        <p
          data-testid="buy-result"
          className={`text-[12px] ${result.rejectReason ? "text-down" : "text-up"}`}
        >
          {result.rejectReason ??
            `${result.status} · ${result.filledKwh.toFixed(3)} kWh${
              result.avgPrice != null ? ` @ ${result.avgPrice.toFixed(4)}` : ""
            }`}
        </p>
      )}
    </div>
  );
}
