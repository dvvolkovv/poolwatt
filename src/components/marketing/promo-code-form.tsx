"use client";

// §42 "регистрация по QR-коду или промокоду партнёра" — the driver's half of
// it. The gift arrives at once, so the form says whose it is rather than
// leaving the person to go looking.

import { useState, useTransition } from "react";
import { redeemPromoCodeAction } from "@/app/[locale]/me/gifts/actions";

export function PromoCodeForm({
  labels,
  initialCode = "",
}: {
  labels: { title: string; field: string; submit: string; done: string };
  initialCode?: string;
}) {
  const [code, setCode] = useState(initialCode);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-6 rounded-lg border border-hairline bg-card p-4"
      data-testid="promo-code-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setDone(null);
        startTransition(async () => {
          const r = await redeemPromoCodeAction({ code });
          if (r.ok) {
            setDone(labels.done.replace("{network}", r.networkName));
            setCode("");
          } else {
            setError(r.formError);
          }
        });
      }}
    >
      <div className="text-[12px] uppercase tracking-[0.14em] text-muted">{labels.title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          aria-label={labels.field}
          data-testid="promo-code-input"
          className="w-44 rounded border border-hairline bg-bg px-3 py-1.5 text-sm uppercase"
        />
        <button
          type="submit"
          disabled={pending || code.trim().length < 3}
          data-testid="promo-code-submit"
          className="rounded border border-accent px-3 py-1.5 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          {labels.submit}
        </button>
      </div>
      {done && (
        <p className="mt-2 text-[13px] text-up" data-testid="promo-code-done">
          {done}
        </p>
      )}
      {error && (
        <p className="mt-2 text-[13px] text-down" data-testid="promo-code-error">
          {error}
        </p>
      )}
    </form>
  );
}
