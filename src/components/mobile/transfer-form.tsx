"use client";

// §22.8, US-19 — перевод кВт·ч другу.
//
// Получатель — ник или чужой QR; сумма; примечание; «получатель
// подтверждает» (§24). Если на счёте привязано устройство, перед отправкой
// берётся подпись отпечатком (§25 SCA) — её проверяет сервер, поэтому форма
// не может эту проверку обойти, даже если бы хотела.

import { useState, useTransition } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { parseUserCode } from "@/lib/exchange/qr-code";
import { QrScan, type QrScanLabels } from "./qr-scan";

export type TransferLabels = QrScanLabels & {
  recipient: string;
  recipientHint: string;
  amount: string;
  note: string;
  requireConfirmation: string;
  send: string;
  sending: string;
  sent: string;
  confirmWithDevice: string;
};

export function TransferForm({
  zoneId,
  hasDevice,
  labels,
  submit,
}: {
  zoneId: string;
  /** На счёте есть привязанное устройство — значит нужна подпись. */
  hasDevice: boolean;
  labels: TransferLabels;
  submit: (input: {
    zoneId: string;
    toUsername: string;
    amountKwh: number;
    note: string;
    requireConfirmation: boolean;
    assertion: unknown;
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [toUsername, setToUsername] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [signing, setSigning] = useState(false);

  async function assertion(): Promise<unknown> {
    if (!hasDevice) return null;
    setSigning(true);
    try {
      const res = await fetch("/api/v1/device-keys/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "transfer" }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not start");
      const { options } = await res.json();
      return await startAuthentication(options);
    } finally {
      setSigning(false);
    }
  }

  function send() {
    setError(null);
    setDone(false);
    const kwh = Number(amount.replace(",", "."));
    if (!(kwh > 0)) {
      setError(labels.amount);
      return;
    }
    start(async () => {
      try {
        const signed = await assertion();
        const result = await submit({
          zoneId,
          toUsername: toUsername.trim().toLowerCase(),
          amountKwh: kwh,
          note,
          requireConfirmation,
          assertion: signed,
        });
        if (result.ok) {
          setDone(true);
          setAmount("");
          setNote("");
        } else {
          setError(result.error ?? "Could not transfer");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not transfer");
      }
    });
  }

  return (
    <section className="mt-6" data-testid="transfer-form">
      <label className="block">
        <span className="text-[12px] uppercase tracking-[0.16em] text-muted">
          {labels.recipient}
        </span>
        <input
          value={toUsername}
          onChange={(e) => setToUsername(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={labels.recipient}
          data-testid="transfer-recipient"
          className="mt-1 w-full rounded-lg border border-hairline bg-card px-3 py-3 text-[16px]"
        />
        <span className="mt-1 block text-[12px] text-muted">{labels.recipientHint}</span>
      </label>

      <div className="mt-3">
        <QrScan<string>
          labels={labels}
          parse={parseUserCode}
          onCode={(nick) => setToUsername(nick)}
        />
      </div>

      <label className="mt-4 block">
        <span className="text-[12px] uppercase tracking-[0.16em] text-muted">
          {labels.amount}
        </span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          aria-label={labels.amount}
          data-testid="transfer-amount"
          className="num mt-1 w-full rounded-lg border border-hairline bg-card px-3 py-3 text-[22px]"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-[12px] uppercase tracking-[0.16em] text-muted">{labels.note}</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          aria-label={labels.note}
          data-testid="transfer-note"
          className="mt-1 w-full rounded-lg border border-hairline bg-card px-3 py-3 text-[15px]"
        />
      </label>

      <label className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[14px]">{labels.requireConfirmation}</span>
        <input
          type="checkbox"
          checked={requireConfirmation}
          onChange={(e) => setRequireConfirmation(e.target.checked)}
          aria-label={labels.requireConfirmation}
          data-testid="transfer-require-confirmation"
          className="h-5 w-5 accent-[var(--accent)]"
        />
      </label>

      <button
        type="button"
        onClick={send}
        disabled={pending || !toUsername.trim() || !amount}
        data-testid="transfer-send"
        className="mt-4 w-full rounded-full bg-accent py-4 text-[14px] font-semibold uppercase tracking-[0.18em] text-accent-foreground disabled:opacity-50"
      >
        {signing ? labels.confirmWithDevice : pending ? labels.sending : labels.send}
      </button>

      {done && (
        <p className="mt-2 text-[14px] text-up" data-testid="transfer-sent">
          {labels.sent}
        </p>
      )}
      {error && (
        <p className="mt-2 text-[14px] text-down" data-testid="transfer-error">
          {error}
        </p>
      )}
    </section>
  );
}
