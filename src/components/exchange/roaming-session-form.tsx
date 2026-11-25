"use client";

// §9.10, US-11 — "при зарядке в другой стране показывается пересчёт до
// подтверждения". Two steps on purpose: nothing is charged until the driver
// has seen the rate, and the confirm button carries the quote's own key.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  confirmRoamingSession,
  quoteRoamingSession,
  type RoamingConfirmResult,
  type RoamingQuoteResult,
} from "@/app/[locale]/me/roaming/actions";
import { newRequestKey } from "@/lib/request-key";

type Zone = { id: string; code: string; currency: string };

type Props = {
  locale: string;
  zones: Zone[];
  defaultZoneId: string;
  labels: {
    zone: string;
    amount: string;
    calculate: string;
    confirm: string;
    noCorridor: string;
    rate: string;
    partner: string;
    fromHome: string;
    debit: string;
    clearingFee: string;
    fromLocal: string;
    toBuy: string;
    money: string;
    unserved: string;
    allowance: string;
    done: string;
    receipt: string;
    recalculate: string;
  };
};

export function RoamingSessionForm({ locale, zones, defaultZoneId, labels }: Props) {
  const [zoneId, setZoneId] = useState(defaultZoneId);
  const [amount, setAmount] = useState("10");
  const [quote, setQuote] = useState<RoamingQuoteResult | null>(null);
  const [done, setDone] = useState<RoamingConfirmResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const requestKey = useRef(newRequestKey());

  const amountNum = Number(amount.replace(",", "."));
  const zone = zones.find((z) => z.id === zoneId);

  function ask() {
    setDone(null);
    startTransition(async () => {
      const r = await quoteRoamingSession({ visitedZoneId: zoneId, amountKwh: amountNum });
      // A fresh quote is a fresh intent: the old key belongs to the old one.
      requestKey.current = newRequestKey();
      setQuote(r);
    });
  }

  function confirm() {
    startTransition(async () => {
      const r = await confirmRoamingSession({
        visitedZoneId: zoneId,
        amountKwh: amountNum,
        idempotencyKey: requestKey.current,
      });
      setDone(r);
      if (r.ok) {
        setQuote(null);
        router.refresh();
      }
    });
  }

  const kwh = (v: number) => v.toFixed(3);

  return (
    <div className="space-y-4" data-testid="roaming-form">
      <div className="flex flex-wrap gap-2">
        <select
          value={zoneId}
          onChange={(e) => {
            setZoneId(e.target.value);
            setQuote(null);
            setDone(null);
          }}
          aria-label={labels.zone}
          data-testid="roaming-zone"
          className="rounded border border-hairline bg-transparent px-2 py-1.5 text-sm"
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
          onChange={(e) => {
            setAmount(e.target.value);
            setQuote(null);
          }}
          aria-label={labels.amount}
          data-testid="roaming-amount"
          className="num w-28 rounded border border-hairline bg-transparent px-2 py-1.5"
        />
        <button
          type="button"
          onClick={ask}
          disabled={pending || !(amountNum > 0)}
          data-testid="roaming-calculate"
          className="rounded border border-hairline px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
        >
          {pending ? "…" : labels.calculate}
        </button>
      </div>

      {quote && !quote.ok && <p className="text-[12px] text-down">{quote.formError}</p>}

      {quote?.ok && (
        <div className="rounded border border-hairline p-4" data-testid="roaming-quote">
          {quote.corridor == null ? (
            <p className="text-[13px] text-muted">{labels.noCorridor}</p>
          ) : (
            <dl className="space-y-1 text-[13px]">
              <Row label={labels.partner} value={quote.corridor.partnerName} />
              <Row
                label={labels.rate}
                value={`1 ${quote.corridor.homeZoneCode} → ${quote.corridor.conversionRate} ${quote.corridor.homeZoneCode}/${zone?.code ?? ""}`}
                testId="roaming-rate"
              />
              <Row label={labels.fromHome} value={`${kwh(quote.kwhFromRoaming)} kWh`} />
              <Row
                label={labels.debit}
                value={`${kwh(quote.roamingDebitKwh)} kWh`}
                testId="roaming-debit"
              />
              <Row label={labels.clearingFee} value={`${kwh(quote.roamingFeeKwh)} kWh`} />
              {quote.corridor.allowanceKwh != null && (
                <Row label={labels.allowance} value={`${kwh(quote.corridor.allowanceKwh)} kWh`} />
              )}
            </dl>
          )}

          <dl className="mt-3 space-y-1 border-t border-hairline pt-3 text-[13px]">
            {quote.kwhFromBalance > 0 && (
              <Row label={labels.fromLocal} value={`${kwh(quote.kwhFromBalance)} kWh`} />
            )}
            {quote.kwhToBuy > 0 && (
              <>
                <Row label={labels.toBuy} value={`${kwh(quote.kwhToBuy)} kWh`} />
                <Row
                  label={labels.money}
                  value={`${quote.total.toFixed(2)} ${quote.currency}`}
                />
              </>
            )}
            {quote.unservedKwh > 0 && (
              <Row label={labels.unserved} value={`${kwh(quote.unservedKwh)} kWh`} />
            )}
          </dl>

          <button
            type="button"
            onClick={confirm}
            disabled={pending || !quote.feasible}
            data-testid="roaming-confirm"
            className="mt-4 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {pending ? "…" : labels.confirm}
          </button>
        </div>
      )}

      {done && !done.ok && <p className="text-[12px] text-down">{done.formError}</p>}
      {done?.ok && (
        <div className="rounded border border-hairline p-4 text-[13px]" data-testid="roaming-done">
          <p className="text-up">
            {labels.done}: <span className="num">{kwh(done.deliveredKwh)}</span> kWh
            {done.kwhFromRoaming > 0 && (
              <>
                {" · "}
                <span className="num">{kwh(done.kwhFromRoaming)}</span> kWh {labels.fromHome}
              </>
            )}
          </p>
          {done.receiptId && (
            <Link
              href={`/${locale}/me/wallet/receipts/${done.receiptId}`}
              prefetch={false}
              className="mt-2 inline-block underline hover:text-accent"
              data-testid="roaming-receipt-link"
            >
              {labels.receipt} →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="num" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
