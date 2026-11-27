"use client";

// §42's gift constructor: trigger, gift, where it works, how long it lives,
// limits, budget, funding source — one row of the table each.

import { useState, useTransition } from "react";
import { createCampaignAction } from "@/app/[locale]/me/charger-operator/[id]/campaigns/actions";

const TRIGGERS = [
  "FIRST_CHARGE",
  "NTH_CHARGE",
  "VOLUME_PERIOD",
  "TOKEN_PAYMENT",
  // §42's other two triggers: a code the driver types, and a birthday.
  "PROMO_CODE",
  "BIRTHDAY",
] as const;
type Trigger = (typeof TRIGGERS)[number];

export interface CampaignFormLabels {
  name: string;
  trigger: string;
  triggerN: string;
  triggerNth: string;
  triggerVolume: string;
  triggerPeriodDays: string;
  giftKwh: string;
  cashbackPct: string;
  scope: string;
  scopeAll: string;
  validityDays: string;
  oncePerClient: string;
  minNextChargeKwh: string;
  budgetKwh: string;
  promoCode: string;
  discountPct: string;
  freeBooking: string;
  budgetGrants: string;
  exclusive: string;
  promoNote: string;
  qrLink: string;
  discountNote: string;
  bookingNote: string;
  funding: string;
  fundingTokens: string;
  fundingFiat: string;
  zone: string;
  from: string;
  to: string;
  create: string;
  triggerNames: Record<string, string>;
}

export function CampaignForm({
  operatorId,
  points,
  zones,
  labels,
}: {
  operatorId: string;
  points: { id: string; name: string }[];
  zones: { id: string; code: string }[];
  labels: CampaignFormLabels;
}) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("FIRST_CHARGE");
  const [triggerN, setTriggerN] = useState("");
  const [triggerPeriodDays, setTriggerPeriodDays] = useState("30");
  const [giftKwh, setGiftKwh] = useState("10");
  const [cashbackPct, setCashbackPct] = useState("5");
  const [scopePointIds, setScopePointIds] = useState<string[]>([]);
  const [validityDays, setValidityDays] = useState("30");
  const [oncePerClient, setOncePerClient] = useState(true);
  const [minNextChargeKwh, setMinNextChargeKwh] = useState("");
  const [budgetKwh, setBudgetKwh] = useState("1000");
  const [promoCode, setPromoCode] = useState("");
  const [discountPct, setDiscountPct] = useState("");
  const [freeBooking, setFreeBooking] = useState(false);
  const [budgetGrants, setBudgetGrants] = useState("100");
  const [exclusive, setExclusive] = useState(false);
  const [fundingSource, setFundingSource] = useState<"TOKENS" | "FIAT">("TOKENS");
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const numberOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <form
      className="space-y-4"
      data-testid="campaign-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await createCampaignAction({
            operatorId,
            name,
            trigger,
            triggerN: trigger === "FIRST_CHARGE" ? null : numberOrNull(triggerN),
            triggerPeriodDays:
              trigger === "VOLUME_PERIOD" ? numberOrNull(triggerPeriodDays) : null,
            // US-12 — a cashback campaign is priced in percent, not in kWh.
            // §42 — a campaign that only gives a free booking promises no kWh.
            giftKwh: trigger === "TOKEN_PAYMENT" ? 0 : Number(giftKwh || 0),
            cashbackPct: trigger === "TOKEN_PAYMENT" ? Number(cashbackPct) : null,
            scopePointIds,
            validityDays: Number(validityDays),
            oncePerClient: trigger === "TOKEN_PAYMENT" ? false : oncePerClient,
            minNextChargeKwh: numberOrNull(minNextChargeKwh),
            budgetKwh: Number(budgetKwh),
            // §42 — the three additions to the constructor.
            promoCode: trigger === "PROMO_CODE" ? promoCode : null,
            discountPct: trigger === "TOKEN_PAYMENT" ? null : numberOrNull(discountPct),
            freeBooking,
            budgetGrants: freeBooking ? Number(budgetGrants) : null,
            exclusive,
            fundingSource,
            zoneId,
            startsAt: startsAt ? new Date(startsAt).toISOString() : null,
            endsAt: endsAt ? new Date(endsAt).toISOString() : null,
          });
          if (!r.ok) setError(r.formError);
          else setName("");
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className="block grow text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.name}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={labels.name}
            className="w-full rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.zone}
          </span>
          <select
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            aria-label={labels.zone}
            className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.code}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.trigger}
          </span>
          <select
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as Trigger)}
            aria-label={labels.trigger}
            className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          >
            {TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {labels.triggerNames[t]}
              </option>
            ))}
          </select>
        </label>

        {trigger !== "FIRST_CHARGE" && trigger !== "TOKEN_PAYMENT" && (
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
              {trigger === "NTH_CHARGE" ? labels.triggerNth : labels.triggerVolume}
            </span>
            <input
              type="number"
              min={1}
              value={triggerN}
              onChange={(e) => setTriggerN(e.target.value)}
              aria-label={labels.triggerN}
              className="num w-28 rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
            />
          </label>
        )}

        {trigger === "PROMO_CODE" && (
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
              {labels.promoCode}
            </span>
            <input
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              aria-label={labels.promoCode}
              data-testid="campaign-promo-code"
              className="w-40 rounded border border-hairline bg-bg px-3 py-1.5 text-sm uppercase"
            />
          </label>
        )}

        {trigger === "VOLUME_PERIOD" && (
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
              {labels.triggerPeriodDays}
            </span>
            <input
              type="number"
              min={1}
              value={triggerPeriodDays}
              onChange={(e) => setTriggerPeriodDays(e.target.value)}
              aria-label={labels.triggerPeriodDays}
              className="num w-28 rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
            />
          </label>
        )}
      </div>

      {trigger === "PROMO_CODE" && (
        <p className="text-[12px] text-muted" data-testid="promo-note">
          {labels.promoNote}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {trigger === "TOKEN_PAYMENT" ? (
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
              {labels.cashbackPct}
            </span>
            <input
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              value={cashbackPct}
              onChange={(e) => setCashbackPct(e.target.value)}
              aria-label={labels.cashbackPct}
              data-testid="campaign-cashback-pct"
              className="num w-28 rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
            />
          </label>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
              {labels.giftKwh}
            </span>
            <input
              type="number"
              min={0.001}
              step={0.001}
              value={giftKwh}
              onChange={(e) => setGiftKwh(e.target.value)}
              aria-label={labels.giftKwh}
              className="num w-28 rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
            />
          </label>
        )}
        {trigger !== "TOKEN_PAYMENT" && (
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
              {labels.discountPct}
            </span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={discountPct}
              onChange={(e) => setDiscountPct(e.target.value)}
              aria-label={labels.discountPct}
              data-testid="campaign-discount-pct"
              className="num w-24 rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
            />
          </label>
        )}
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.validityDays}
          </span>
          <input
            type="number"
            min={1}
            value={validityDays}
            onChange={(e) => setValidityDays(e.target.value)}
            aria-label={labels.validityDays}
            className="num w-24 rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.budgetKwh}
          </span>
          <input
            type="number"
            min={0.001}
            step={0.001}
            value={budgetKwh}
            onChange={(e) => setBudgetKwh(e.target.value)}
            aria-label={labels.budgetKwh}
            className="num w-32 rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.minNextChargeKwh}
          </span>
          <input
            type="number"
            min={0}
            step={0.001}
            value={minNextChargeKwh}
            onChange={(e) => setMinNextChargeKwh(e.target.value)}
            aria-label={labels.minNextChargeKwh}
            className="num w-28 rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.funding}
          </span>
          <select
            value={fundingSource}
            onChange={(e) => setFundingSource(e.target.value as "TOKENS" | "FIAT")}
            aria-label={labels.funding}
            className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          >
            <option value="TOKENS">{labels.fundingTokens}</option>
            <option value="FIAT">{labels.fundingFiat}</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.scope}
          </span>
          <select
            multiple
            value={scopePointIds}
            onChange={(e) =>
              setScopePointIds(Array.from(e.target.selectedOptions).map((o) => o.value))
            }
            aria-label={labels.scope}
            className="min-w-[220px] rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          >
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[12px] text-muted">{labels.scopeAll}</span>
        </label>

        {/* US-12 — cashback is earned by every token payment, so the
            once-per-client limit does not apply to it. §42 — a promo code is
            redeemed once by one driver, whatever the box says. */}
        {trigger !== "TOKEN_PAYMENT" && trigger !== "PROMO_CODE" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={oncePerClient}
              onChange={(e) => setOncePerClient(e.target.checked)}
            />
            {labels.oncePerClient}
          </label>
        )}

        {/* §42 "не суммируется с другими акциями". */}
        {trigger !== "TOKEN_PAYMENT" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={exclusive}
              onChange={(e) => setExclusive(e.target.checked)}
              data-testid="campaign-exclusive"
            />
            {labels.exclusive}
          </label>
        )}

        {/* §42 "бесплатная бронь", on its own or next to the energy gift. */}
        {trigger !== "TOKEN_PAYMENT" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={freeBooking}
              onChange={(e) => setFreeBooking(e.target.checked)}
              data-testid="campaign-free-booking"
            />
            {labels.freeBooking}
          </label>
        )}

        {freeBooking && (
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
              {labels.budgetGrants}
            </span>
            <input
              type="number"
              min={1}
              value={budgetGrants}
              onChange={(e) => setBudgetGrants(e.target.value)}
              aria-label={labels.budgetGrants}
              data-testid="campaign-budget-grants"
              className="num w-28 rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
            />
          </label>
        )}
      </div>

      {Number(discountPct) > 0 && (
        <p className="text-[12px] text-muted" data-testid="discount-note">
          {labels.discountNote}
        </p>
      )}
      {freeBooking && (
        <p className="text-[12px] text-muted" data-testid="booking-note">
          {labels.bookingNote}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[12px] text-muted">{labels.from}</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            aria-label={labels.from}
            className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[12px] text-muted">{labels.to}</span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            aria-label={labels.to}
            className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending || name.trim().length < 2 || !zoneId}
        className="rounded border border-accent px-3 py-1.5 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        {labels.create}
      </button>

      {error && (
        <p className="text-[13px] text-down" data-testid="campaign-error">
          {error}
        </p>
      )}
    </form>
  );
}
