"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateChargerOperatorPrice } from "../actions";

const CURRENCY_OPTIONS = ["EUR", "USD", "GBP", "CZK", "PLN", "CHF", "RUB", "UAH"] as const;
type Currency = (typeof CURRENCY_OPTIONS)[number];

type Props = {
  operatorId: string;
  initial: {
    pricePerKwh: string | null; // Decimal serializes to string from Prisma
    priceCurrency: string | null;
    priceUpdatedAt: string | null; // ISO date
  };
  labels: {
    sectionTitle: string;
    help: string;
    pricePerKwh: string;
    pricePerKwhPlaceholder: string;
    currency: string;
    save: string;
    clear: string;
    cleared: string;
    saved: string;
    notSet: string;
    updatedAtPrefix: string;
  };
};

export function PriceForm({ operatorId, initial, labels }: Props) {
  const [price, setPrice] = useState(initial.pricePerKwh ?? "");
  const [currency, setCurrency] = useState<Currency>((initial.priceCurrency as Currency) ?? "EUR");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<"saved" | "cleared" | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const hasExistingPrice = initial.pricePerKwh !== null;

  function submit(action: "save" | "clear") {
    setErrors({});
    setSavedAt(null);
    startTransition(async () => {
      // Accept both "0,42" and "0.42" — Slovak/Russian keyboards prefer comma.
      const numeric = action === "save" ? Number(price.replace(",", ".")) : null;
      const r = await updateChargerOperatorPrice({
        operatorId,
        pricePerKwh: numeric,
        currency: action === "save" ? currency : null,
      });
      if (r.ok) {
        setSavedAt(action === "save" ? "saved" : "cleared");
        if (action === "clear") setPrice("");
        router.refresh();
      } else {
        setErrors(r.fieldErrors ?? { _form: r.formError ?? "Save failed." });
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit("save");
      }}
      className="space-y-4"
    >
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{labels.sectionTitle}</h2>
        <p className="text-xs text-muted mt-1">{labels.help}</p>
      </div>

      {hasExistingPrice && initial.priceUpdatedAt && (
        <div className="text-xs text-muted">
          {labels.updatedAtPrefix}:{" "}
          <span className="num text-foreground">
            {new Date(initial.priceUpdatedAt).toLocaleString()}
          </span>
        </div>
      )}
      {!hasExistingPrice && (
        <div className="text-xs text-muted italic">{labels.notSet}</div>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label htmlFor="pricePerKwh" className="block text-sm font-medium mb-1">
            {labels.pricePerKwh}
          </label>
          <input
            id="pricePerKwh"
            type="text"
            inputMode="decimal"
            placeholder={labels.pricePerKwhPlaceholder}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full px-3 py-2 rounded border border-hairline bg-card num"
          />
          {errors.pricePerKwh && <p className="text-xs text-down mt-1">{errors.pricePerKwh}</p>}
        </div>
        <div>
          <label htmlFor="currency" className="block text-sm font-medium mb-1">
            {labels.currency}
          </label>
          <select
            id="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            className="px-3 py-2 rounded border border-hairline bg-card"
          >
            {CURRENCY_OPTIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {errors.currency && <p className="text-xs text-down mt-1">{errors.currency}</p>}
        </div>
      </div>

      {errors._form && <p className="text-sm text-down">{errors._form}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-full font-semibold text-sm bg-accent text-accent-foreground disabled:opacity-50"
        >
          {labels.save}
        </button>
        {hasExistingPrice && (
          <button
            type="button"
            disabled={pending}
            onClick={() => submit("clear")}
            className="px-4 py-2 rounded-full font-medium text-sm text-muted hover:text-foreground border border-hairline disabled:opacity-50"
          >
            {labels.clear}
          </button>
        )}
        {savedAt === "saved" && <span className="text-xs text-up">✓ {labels.saved}</span>}
        {savedAt === "cleared" && <span className="text-xs text-up">✓ {labels.cleared}</span>}
      </div>
    </form>
  );
}
