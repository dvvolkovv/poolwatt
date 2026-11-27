"use client";

// §51 «Компенсации» на рабочем месте поддержки.
//
// Две кнопки, и разница между ними не в оформлении: сумму возврата оператор
// называет сам (он сверился с сеансом), а размер подарка назначил партнёр —
// оператор решает «да или нет». Поэтому у подарка нет полей.

import { useState, useTransition } from "react";
import {
  compensateTicket,
  refundTicket,
} from "@/app/[locale]/me/tickets/actions";

export interface CompensationLabels {
  heading: string;
  given: string;
  session: string;
  leftToRefund: string;
  amount: string;
  reason: string;
  refund: string;
  refunding: string;
  compensate: string;
  cardClosed: string;
  noCampaign: string;
  noSession: string;
}

export interface CompensationSession {
  pointName: string | null;
  at: string | null;
  chargedFiat: number;
  refundableFiat: number;
  currency: string;
  byCard: boolean;
}

export function TicketCompensationPanel({
  ticketId,
  session,
  compensation,
  giftKwh,
  giftGiven,
  labels,
}: {
  ticketId: string;
  /** Сеанс, который обжалуют, если заявка его называет. */
  session: CompensationSession | null;
  /** Строка §51: что сеть уже вернула. */
  compensation: string | null;
  /** Сколько кВт·ч настроил партнёр, или null — не настроил. */
  giftKwh: number | null;
  giftGiven: boolean;
  labels: CompensationLabels;
}) {
  const [amount, setAmount] = useState(
    session ? session.refundableFiat.toFixed(2) : "",
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sendRefund() {
    setError(null);
    startTransition(async () => {
      const result = await refundTicket({ ticketId, amountFiat: amount, reason });
      if (!result.ok) {
        setError(result.formError);
        return;
      }
      setReason("");
    });
  }

  function sendCompensation() {
    setError(null);
    startTransition(async () => {
      const result = await compensateTicket({ ticketId });
      if (!result.ok) setError(result.formError);
    });
  }

  return (
    <section className="mt-6 rounded border border-hairline p-4" data-testid="ticket-compensation">
      <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted">{labels.heading}</h2>

      {compensation && (
        <p className="mt-2 text-[13px]" data-testid="ticket-compensation-given">
          {labels.given}: <span className="num">{compensation}</span>
        </p>
      )}

      {session ? (
        <div className="mt-3">
          <p className="text-[12px] text-muted">
            {labels.session}:{" "}
            {[session.pointName, session.at?.slice(0, 16).replace("T", " ")]
              .filter(Boolean)
              .join(", ")}{" "}
            · <span className="num">{session.chargedFiat.toFixed(2)} {session.currency}</span>
          </p>
          {session.byCard ? (
            <p className="mt-2 text-[12px] text-muted" data-testid="ticket-refund-closed">
              {labels.cardClosed}
            </p>
          ) : session.refundableFiat > 0 ? (
            <>
              <p className="mt-1 text-[12px] text-muted">
                {labels.leftToRefund}:{" "}
                <span className="num">
                  {session.refundableFiat.toFixed(2)} {session.currency}
                </span>
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-[12px] text-muted">
                  {labels.amount}
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    data-testid="ticket-refund-amount"
                    className="num mt-1 block w-28 rounded border border-hairline bg-transparent px-2 py-1 text-[13px]"
                  />
                </label>
                <label className="min-w-[200px] flex-1 text-[12px] text-muted">
                  {labels.reason}
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    data-testid="ticket-refund-reason"
                    className="mt-1 block w-full rounded border border-hairline bg-transparent px-2 py-1 text-[13px]"
                  />
                </label>
                <button
                  type="button"
                  disabled={pending || reason.trim().length === 0}
                  onClick={sendRefund}
                  data-testid="ticket-refund"
                  className="rounded bg-accent px-4 py-2 text-[13px] text-background disabled:opacity-50"
                >
                  {pending ? labels.refunding : labels.refund}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-muted">{labels.noSession}</p>
      )}

      <div className="mt-4 border-t border-hairline pt-3">
        {giftKwh == null ? (
          <p className="text-[12px] text-muted" data-testid="ticket-no-compensation-campaign">
            {labels.noCampaign}
          </p>
        ) : (
          <button
            type="button"
            disabled={pending || giftGiven}
            onClick={sendCompensation}
            data-testid="ticket-compensate"
            className="rounded border border-accent px-4 py-2 text-[13px] text-accent disabled:opacity-50"
          >
            {labels.compensate.replace("{kwh}", giftKwh.toFixed(3))}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 text-[12px] text-down" data-testid="ticket-compensation-error">
          {error}
        </p>
      )}
    </section>
  );
}
