"use client";

// The order form of ТЗ §6's terminal mock-up: side, market or limit, amount,
// price, and the reserve the order will hold. The all-in cost is previewed
// before submission, per §54.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitOrder, type OrderActionResult } from "@/app/[locale]/exchange/actions";

type Props = {
  zoneId: string;
  zoneCode: string;
  currency: string;
  intervalStart: string;
  bestBid: number | null;
  bestAsk: number | null;
  corridor: { min: number; max: number } | null;
  kwhBalance: number;
  availableFiat: number;
  /** Translated strings, resolved on the server (next-intl is server-side). */
  labels: TicketLabels;
};

export type TicketLabels = {
  title: string;
  buy: string;
  sell: string;
  market: string;
  limit: string;
  amount: string;
  price: string;
  interval: string;
  estimate: string;
  balanceKwh: string;
  availableFiat: string;
  submit: string;
  corridorHint: string;
  filled: string;
  rejected: string;
};

export function OrderTicket(props: Props) {
  const TEXT = props.labels;
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [type, setType] = useState<"MARKET" | "LIMIT">("LIMIT");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState(
    props.bestAsk != null ? props.bestAsk.toFixed(4) : props.bestBid?.toFixed(4) ?? "",
  );
  const [pinInterval, setPinInterval] = useState(true);
  const [result, setResult] = useState<OrderActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Slovak and Russian keyboards produce a comma for the decimal separator.
  const amountNum = Number(amount.replace(",", "."));
  const priceNum = Number(price.replace(",", "."));

  const estimate = useMemo(() => {
    if (!Number.isFinite(amountNum) || amountNum <= 0) return null;
    const reference =
      type === "LIMIT" && Number.isFinite(priceNum) && priceNum > 0
        ? priceNum
        : side === "BUY"
          ? props.bestAsk
          : props.bestBid;
    if (reference == null) return null;
    return Math.round(amountNum * reference * 100) / 100;
  }, [amountNum, priceNum, type, side, props.bestAsk, props.bestBid]);

  const outsideCorridor =
    type === "LIMIT" &&
    props.corridor != null &&
    Number.isFinite(priceNum) &&
    priceNum > 0 &&
    (priceNum < props.corridor.min || priceNum > props.corridor.max);

  function submit() {
    setResult(null);
    startTransition(async () => {
      const r = await submitOrder({
        zoneId: props.zoneId,
        side,
        type,
        amountKwh: amountNum,
        limitPrice: type === "LIMIT" ? priceNum : null,
        intervalStart: pinInterval ? props.intervalStart : null,
      });
      setResult(r);
      if (r.ok) {
        setAmount("");
        router.refresh();
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="border border-hairline rounded p-4 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted">{TEXT.title}</h2>
        <span className="text-[12px] text-muted">{props.zoneCode}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`py-2 rounded border text-sm ${
              side === s
                ? s === "BUY"
                  ? "border-up text-up"
                  : "border-down text-down"
                : "border-hairline text-muted"
            }`}
          >
            {s === "BUY" ? TEXT.buy : TEXT.sell}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["LIMIT", "MARKET"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setType(k)}
            className={`py-1.5 rounded border text-[13px] ${
              type === k ? "border-accent text-accent" : "border-hairline text-muted"
            }`}
          >
            {k === "LIMIT" ? TEXT.limit : TEXT.market}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-[12px] text-muted">{TEXT.amount}</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="100.000"
          className="mt-1 w-full border border-hairline rounded px-2 py-1.5 bg-transparent num"
        />
      </label>

      {type === "LIMIT" && (
        <label className="block">
          <span className="text-[12px] text-muted">
            {TEXT.price}, {props.currency}/kWh
          </span>
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.2000"
            className="mt-1 w-full border border-hairline rounded px-2 py-1.5 bg-transparent num"
          />
          {props.corridor && (
            <span
              className={`block text-[11px] mt-1 num ${outsideCorridor ? "text-down" : "text-muted"}`}
            >
              {TEXT.corridorHint}: {props.corridor.min.toFixed(4)} – {props.corridor.max.toFixed(4)}
            </span>
          )}
        </label>
      )}

      <label className="flex items-center gap-2 text-[12px] text-muted">
        <input
          type="checkbox"
          checked={pinInterval}
          onChange={(e) => setPinInterval(e.target.checked)}
        />
        {TEXT.interval}: {props.intervalStart.slice(11, 16)}Z
      </label>

      <dl className="text-[12px] space-y-1 border-t border-hairline pt-3">
        <Row label={TEXT.estimate} value={estimate == null ? "—" : `${estimate.toFixed(2)} ${props.currency}`} />
        <Row label={TEXT.balanceKwh} value={`${props.kwhBalance.toFixed(3)} kWh`} />
        <Row label={TEXT.availableFiat} value={`${props.availableFiat.toFixed(2)} ${props.currency}`} />
      </dl>

      <button
        type="submit"
        disabled={pending || !(amountNum > 0)}
        className="w-full py-2 rounded bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {pending ? "…" : TEXT.submit}
      </button>

      {result && !result.ok && <p className="text-[12px] text-down">{result.formError}</p>}
      {result?.ok && (
        <p className={`text-[12px] ${result.rejectReason ? "text-down" : "text-up"}`}>
          {result.rejectReason
            ? `${TEXT.rejected}: ${result.rejectReason}`
            : `${result.status} · ${result.filledKwh.toFixed(3)} kWh ${TEXT.filled}${
                result.avgPrice != null ? ` @ ${result.avgPrice.toFixed(4)}` : ""
              }`}
        </p>
      )}
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
