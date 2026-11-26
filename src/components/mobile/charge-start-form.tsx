"use client";

// §54 «клиент видит итоговую цену и все платы до подтверждения», §16.6 —
// построчно, из чего складывается сеанс, и сколько держим в резерве.
//
// Суммы — чипы: водитель стоит у станции, а не вводит число. Смена чипа
// перезагружает расчёт на сервере, потому что цена недостающего берётся из
// живой книги, а не угадывается в браузере.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startCharge } from "@/app/[locale]/app/charge/actions";
import { newRequestKey } from "@/lib/request-key";

export type ChargePlanView = {
  kwhFromGift: number;
  kwhFromBalance: number;
  kwhFromRoaming: number;
  kwhFromMarket: number;
  kwhFromAggregator: number;
  unservedKwh: number;
  deliverableKwh: number;
  fee: number;
  total: number;
  authorizedFiat: number;
  currency: string;
};

export type ChargeStartLabels = {
  point: string;
  connector: string;
  amount: string;
  breakdown: string;
  fromGift: string;
  fromBalance: string;
  fromRoaming: string;
  fromMarket: string;
  fromAggregator: string;
  fee: string;
  total: string;
  authorized: string;
  authorizedHint: string;
  start: string;
  noLiquidity: string;
};

export function ChargeStartForm({
  locale,
  point,
  connector,
  amounts,
  planned,
  plan,
  labels,
}: {
  locale: string;
  point: { id: string; name: string; address: string };
  connector: { id: string; type: string; powerKw: number };
  amounts: number[];
  planned: number;
  plan: ChargePlanView;
  labels: ChargeStartLabels;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // §15 — один ключ на одно намерение.
  const requestKey = useRef(newRequestKey());

  const rows: { label: string; kwh: number }[] = [
    { label: labels.fromGift, kwh: plan.kwhFromGift },
    { label: labels.fromBalance, kwh: plan.kwhFromBalance },
    { label: labels.fromRoaming, kwh: plan.kwhFromRoaming },
    { label: labels.fromMarket, kwh: plan.kwhFromMarket },
    { label: labels.fromAggregator, kwh: plan.kwhFromAggregator },
  ].filter((r) => r.kwh > 0);

  const servable = plan.unservedKwh <= 0 && plan.deliverableKwh > 0;

  function begin() {
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("pointId", point.id);
      form.set("connectorId", connector.id);
      form.set("plannedKwh", String(planned));
      form.set("idempotencyKey", requestKey.current);
      const result = await startCharge(form);
      if (result.error) {
        setError(result.error);
        requestKey.current = newRequestKey();
        return;
      }
      router.push(`/${locale}/app/charge`);
    });
  }

  return (
    <div>
      <section className="rounded-lg border border-hairline bg-card px-4 py-3">
        <div className="text-[12px] uppercase tracking-[0.16em] text-muted">
          {labels.point}
        </div>
        <div className="mt-1 text-[16px]" data-testid="charge-point-name">
          {point.name}
        </div>
        {point.address && <div className="text-[13px] text-muted">{point.address}</div>}
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-[13px] text-muted">{labels.connector}</span>
          <span className="text-[14px]">
            {connector.type} · <span className="num">{connector.powerKw}</span> kW
          </span>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">
          {labels.amount}
        </h2>
        <div className="mt-2 flex gap-2">
          {amounts.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() =>
                router.push(
                  `/${locale}/app/charge/start?p=${point.id}&c=${connector.id}&kwh=${a}`,
                )
              }
              aria-pressed={a === planned}
              data-testid={`charge-amount-${a}`}
              className={`num flex-1 rounded-lg border px-3 py-3 text-[15px] ${
                a === planned
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-hairline bg-card"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">
          {labels.breakdown}
        </h2>
        <ul
          className="mt-2 divide-y divide-hairline rounded-lg border border-hairline bg-card"
          data-testid="charge-breakdown"
        >
          {rows.map((r) => (
            <li key={r.label} className="flex items-baseline justify-between px-4 py-3">
              <span className="text-[13px] text-muted">{r.label}</span>
              <span className="num text-[15px]">{r.kwh.toFixed(3)} kWh</span>
            </li>
          ))}
          {plan.fee > 0 && (
            <li className="flex items-baseline justify-between px-4 py-3">
              <span className="text-[13px] text-muted">{labels.fee}</span>
              <span className="num text-[15px]">
                {plan.fee.toFixed(2)} {plan.currency}
              </span>
            </li>
          )}
          <li className="flex items-baseline justify-between px-4 py-3">
            <span className="text-[13px]">{labels.total}</span>
            <span className="num text-[16px]" data-testid="charge-total">
              {plan.total.toFixed(2)} {plan.currency}
            </span>
          </li>
          {plan.authorizedFiat > 0 && (
            <li className="px-4 py-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-muted">{labels.authorized}</span>
                <span className="num text-[15px]">
                  {plan.authorizedFiat.toFixed(2)} {plan.currency}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-muted">{labels.authorizedHint}</p>
            </li>
          )}
        </ul>
      </section>

      {servable ? (
        <button
          type="button"
          onClick={begin}
          disabled={pending}
          data-testid="charge-start"
          className="mt-6 w-full rounded-lg bg-accent px-4 py-4 text-[16px] font-medium text-accent-foreground disabled:opacity-60"
        >
          {labels.start}
        </button>
      ) : (
        <p className="mt-6 text-[14px] text-down" data-testid="charge-no-liquidity">
          {labels.noLiquidity}
        </p>
      )}

      {error && (
        <p className="mt-3 text-[13px] text-down" data-testid="charge-error">
          {error}
        </p>
      )}
    </div>
  );
}
