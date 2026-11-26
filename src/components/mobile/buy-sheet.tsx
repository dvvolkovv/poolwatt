"use client";

// US-07 "покупка по рыночной цене в один клик" на телефоне: три крупные
// кнопки, под ними своя сумма с необязательной лимитной ценой.
//
// Логика покупки не дублируется — это то же серверное действие
// `submitBuyAhead`, которым покупает кабинет. Разная здесь только вёрстка: в
// кабинете мишени размером с курсор, тут размером с палец.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitBuyAhead, type OrderActionResult } from "@/app/[locale]/exchange/actions";
import { newRequestKey } from "@/lib/request-key";

export type BuyQuote = { zoneId: string; amountKwh: number; estimate: number | null };

export type BuySheetLabels = {
  amount: string;
  limitPrice: string;
  buy: string;
  otherAmount: string;
  noLiquidity: string;
};

export function BuySheet({
  zones,
  defaultZoneId,
  quotes,
  labels,
}: {
  zones: { id: string; code: string; currency: string }[];
  defaultZoneId: string;
  quotes: BuyQuote[];
  labels: BuySheetLabels;
}) {
  const [zoneId, setZoneId] = useState(defaultZoneId);
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<OrderActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // §15 — один ключ на одно намерение, поэтому второе нажатие не купит
  // второй раз.
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
    <div className="mt-4">
      {/* Зону выбирают только те, у кого кошелёк не один. */}
      {zones.length > 1 && (
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {zones.map((z) => (
            <button
              key={z.id}
              type="button"
              data-zone-chip={z.code}
              onClick={() => setZoneId(z.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] ${
                z.id === zoneId ? "border-accent text-accent" : "border-hairline text-muted"
              }`}
            >
              {z.code}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2" data-testid="quick-buy">
        {zoneQuotes.map((q) => (
          <button
            key={q.amountKwh}
            type="button"
            disabled={pending || q.estimate == null}
            onClick={() => buy(q.amountKwh, null)}
            data-testid={`quick-buy-${q.amountKwh}`}
            className="rounded-lg border border-hairline bg-card px-2 py-4 disabled:opacity-40"
          >
            <span className="num block text-[17px] font-semibold">{q.amountKwh}</span>
            <span className="block text-[11px] text-muted">kWh</span>
            <span className="num mt-1 block text-[11px] text-muted-strong">
              {q.estimate == null
                ? labels.noLiquidity
                : `≈ ${q.estimate.toFixed(2)} ${zone?.currency ?? ""}`}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="other-amount"
        className="mt-3 w-full rounded-lg border border-hairline py-3 text-[14px] text-muted-strong"
      >
        {labels.otherAmount}
      </button>

      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            buy(amountNum, limitNum);
          }}
          className="mt-3 space-y-3"
        >
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={labels.amount}
            aria-label={labels.amount}
            className="num w-full rounded-lg border border-hairline bg-transparent px-3 py-3"
          />
          <input
            inputMode="decimal"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            placeholder={`${labels.limitPrice}${zone ? `, ${zone.currency}/kWh` : ""}`}
            aria-label={labels.limitPrice}
            className="num w-full rounded-lg border border-hairline bg-transparent px-3 py-3"
          />
          <button
            type="submit"
            disabled={pending || !(amountNum > 0)}
            className="w-full rounded-lg bg-accent py-3 font-semibold text-accent-foreground
                       disabled:opacity-40"
          >
            {pending ? "…" : labels.buy}
          </button>
        </form>
      )}

      {result && !result.ok && <p className="mt-3 text-[12px] text-down">{result.formError}</p>}
      {result?.ok && (
        <p
          data-testid="buy-result"
          className={`mt-3 text-[12px] ${result.rejectReason ? "text-down" : "text-up"}`}
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
