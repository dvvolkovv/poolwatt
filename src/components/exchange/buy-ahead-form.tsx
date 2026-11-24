"use client";

// US-07 "покупка кВт·ч впрок" — one click at the market price, or a limit
// price to wait for a better one.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitBuyAhead, type OrderActionResult } from "@/app/[locale]/exchange/actions";

type Props = {
  zones: { id: string; code: string; currency: string }[];
  defaultZoneId: string;
  labels: { amount: string; limitPrice: string; buy: string };
};

export function BuyAheadForm({ zones, defaultZoneId, labels }: Props) {
  const [zoneId, setZoneId] = useState(defaultZoneId);
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [result, setResult] = useState<OrderActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const amountNum = Number(amount.replace(",", "."));
  const limitNum = limitPrice.trim() === "" ? null : Number(limitPrice.replace(",", "."));
  const zone = zones.find((z) => z.id === zoneId);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        startTransition(async () => {
          const r = await submitBuyAhead({ zoneId, amountKwh: amountNum, limitPrice: limitNum });
          setResult(r);
          if (r.ok) {
            setAmount("");
            router.refresh();
          }
        });
      }}
      className="space-y-3"
    >
      <div className="flex gap-2">
        <select
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
          className="border border-hairline rounded px-2 py-1.5 bg-transparent text-sm"
        >
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.code}
            </option>
          ))}
        </select>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={labels.amount}
          aria-label={labels.amount}
          className="flex-1 border border-hairline rounded px-2 py-1.5 bg-transparent num"
        />
      </div>

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

      {result && !result.ok && <p className="text-[12px] text-down">{result.formError}</p>}
      {result?.ok && (
        <p className={`text-[12px] ${result.rejectReason ? "text-down" : "text-up"}`}>
          {result.rejectReason ??
            `${result.status} · ${result.filledKwh.toFixed(3)} kWh${
              result.avgPrice != null ? ` @ ${result.avgPrice.toFixed(4)}` : ""
            }`}
        </p>
      )}
    </form>
  );
}
