"use client";

// §53 — the operator's two forms: a plan, and putting a partner on one with
// individual terms written over it.

import { useState, useTransition } from "react";
import { assignPlanAction, savePlanAction } from "@/app/[locale]/admin/fee-plans/actions";

const TIERS = ["BASIC", "EXTENDED", "CORPORATE"] as const;
const TYPES = ["PRODUCER", "WHOLESALE", "COOPERATIVE", "OPERATOR"] as const;
const PERIODS = ["month", "quarter", "year"] as const;

const field = "rounded border border-hairline bg-bg px-2 py-1 text-sm";
const label = "mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted";

export interface PlanFormLabels {
  name: string;
  tier: string;
  participantType: string;
  anyType: string;
  tradeFeePct: string;
  chargeFeePct: string;
  bookingFeePct: string;
  subscriptionFiat: string;
  subscriptionPeriod: string;
  currency: string;
  includedInvoices: string;
  includedCampaigns: string;
  isDefault: string;
  active: string;
  save: string;
  tierNames: Record<string, string>;
  typeNames: Record<string, string>;
  periodNames: Record<string, string>;
}

export interface PlanInitial {
  name: string;
  tier: string;
  participantType: string | null;
  tradeFeePct: number;
  chargeFeePct: number;
  bookingFeePct: number;
  subscriptionFiat: number;
  subscriptionPeriod: string;
  currency: string;
  includedInvoices: number | null;
  includedCampaigns: number | null;
  isDefault: boolean;
  active: boolean;
}

export function PlanForm({
  initial,
  labels,
}: {
  initial?: PlanInitial;
  labels: PlanFormLabels;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [tier, setTier] = useState(initial?.tier ?? "BASIC");
  const [participantType, setParticipantType] = useState(initial?.participantType ?? "");
  const [tradeFeePct, setTradeFeePct] = useState(String(initial?.tradeFeePct ?? 1));
  const [chargeFeePct, setChargeFeePct] = useState(String(initial?.chargeFeePct ?? 2));
  const [bookingFeePct, setBookingFeePct] = useState(String(initial?.bookingFeePct ?? 0));
  const [subscriptionFiat, setSubscriptionFiat] = useState(String(initial?.subscriptionFiat ?? 0));
  const [subscriptionPeriod, setSubscriptionPeriod] = useState(
    initial?.subscriptionPeriod ?? "month",
  );
  const [currency, setCurrency] = useState(initial?.currency ?? "EUR");
  const [includedInvoices, setIncludedInvoices] = useState(
    initial?.includedInvoices == null ? "" : String(initial.includedInvoices),
  );
  const [includedCampaigns, setIncludedCampaigns] = useState(
    initial?.includedCampaigns == null ? "" : String(initial.includedCampaigns),
  );
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const intOrNull = (v: string) => (v.trim() === "" ? null : Math.trunc(Number(v)));

  const rates: readonly [string, string, (v: string) => void][] = [
    [labels.tradeFeePct, tradeFeePct, setTradeFeePct],
    [labels.chargeFeePct, chargeFeePct, setChargeFeePct],
    [labels.bookingFeePct, bookingFeePct, setBookingFeePct],
  ];

  return (
    <form
      className="space-y-3"
      data-testid={initial ? `plan-form-${initial.name}` : "plan-form-new"}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await savePlanAction({
            name,
            tier,
            participantType: participantType === "" ? null : participantType,
            tradeFeePct: Number(tradeFeePct),
            chargeFeePct: Number(chargeFeePct),
            bookingFeePct: Number(bookingFeePct),
            subscriptionFiat: Number(subscriptionFiat),
            subscriptionPeriod,
            currency,
            includedInvoices: intOrNull(includedInvoices),
            includedCampaigns: intOrNull(includedCampaigns),
            isDefault,
            active,
          });
          if (!r.ok) setError(r.formError);
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className="block text-sm">
          <span className={label}>{labels.name}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            readOnly={!!initial}
            aria-label={initial ? `${labels.name} ${initial.name}` : labels.name}
            className={`${field} w-[180px] ${initial ? "text-muted" : ""}`}
          />
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.tier}</span>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            aria-label={labels.tier}
            className={field}
          >
            {TIERS.map((v) => (
              <option key={v} value={v}>
                {labels.tierNames[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.participantType}</span>
          <select
            value={participantType}
            onChange={(e) => setParticipantType(e.target.value)}
            aria-label={labels.participantType}
            className={field}
          >
            <option value="">{labels.anyType}</option>
            {TYPES.map((v) => (
              <option key={v} value={v}>
                {labels.typeNames[v]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        {rates.map(([text, value, set]) => (
          <label key={text} className="block text-sm">
            <span className={label}>{text}</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={value}
              onChange={(e) => set(e.target.value)}
              aria-label={initial ? `${text} ${initial.name}` : text}
              className={`num ${field} w-24`}
            />
          </label>
        ))}
        <label className="block text-sm">
          <span className={label}>{labels.subscriptionFiat}</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={subscriptionFiat}
            onChange={(e) => setSubscriptionFiat(e.target.value)}
            aria-label={labels.subscriptionFiat}
            className={`num ${field} w-28`}
          />
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.subscriptionPeriod}</span>
          <select
            value={subscriptionPeriod}
            onChange={(e) => setSubscriptionPeriod(e.target.value)}
            aria-label={labels.subscriptionPeriod}
            className={field}
          >
            {PERIODS.map((v) => (
              <option key={v} value={v}>
                {labels.periodNames[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.currency}</span>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            aria-label={labels.currency}
            className={`${field} w-20`}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="block">
          <span className={label}>{labels.includedInvoices}</span>
          <input
            type="number"
            min={0}
            value={includedInvoices}
            onChange={(e) => setIncludedInvoices(e.target.value)}
            aria-label={labels.includedInvoices}
            className={`num ${field} w-24`}
          />
        </label>
        <label className="block">
          <span className={label}>{labels.includedCampaigns}</span>
          <input
            type="number"
            min={0}
            value={includedCampaigns}
            onChange={(e) => setIncludedCampaigns(e.target.value)}
            aria-label={labels.includedCampaigns}
            className={`num ${field} w-24`}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          {labels.isDefault}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {labels.active}
        </label>
        <button
          type="submit"
          disabled={pending || name.trim().length < 2}
          data-testid={initial ? `save-plan-${initial.name}` : "save-plan-new"}
          className="rounded border border-accent px-3 py-1 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          {labels.save}
        </button>
      </div>

      {error && (
        <p className="text-[13px] text-down" data-testid="plan-error">
          {error}
        </p>
      )}
    </form>
  );
}

export interface AssignFormLabels {
  plan: string;
  company: string;
  network: string;
  none: string;
  overrideTrade: string;
  overrideCharge: string;
  overrideBooking: string;
  note: string;
  assign: string;
  help: string;
}

export function AssignForm({
  plans,
  companies,
  operators,
  labels,
}: {
  plans: { id: string; name: string }[];
  companies: { id: string; legalName: string }[];
  operators: { id: string; displayName: string }[];
  labels: AssignFormLabels;
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [companyId, setCompanyId] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [trade, setTrade] = useState("");
  const [charge, setCharge] = useState("");
  const [booking, setBooking] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  const overrides: readonly [string, string, (v: string) => void][] = [
    [labels.overrideTrade, trade, setTrade],
    [labels.overrideCharge, charge, setCharge],
    [labels.overrideBooking, booking, setBooking],
  ];

  return (
    <form
      className="space-y-3"
      data-testid="assign-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await assignPlanAction({
            planId,
            companyId: companyId || null,
            operatorId: operatorId || null,
            overrideTradeFeePct: numOrNull(trade),
            overrideChargeFeePct: numOrNull(charge),
            overrideBookingFeePct: numOrNull(booking),
            note: note.trim() || null,
          });
          if (!r.ok) setError(r.formError);
          else {
            setTrade("");
            setCharge("");
            setBooking("");
            setNote("");
          }
        });
      }}
    >
      <p className="text-[12px] text-muted">{labels.help}</p>
      <div className="flex flex-wrap gap-3">
        <label className="block text-sm">
          <span className={label}>{labels.plan}</span>
          <select
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            aria-label={labels.plan}
            className={field}
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.company}</span>
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              if (e.target.value) setOperatorId("");
            }}
            aria-label={labels.company}
            className={field}
          >
            <option value="">{labels.none}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.network}</span>
          <select
            value={operatorId}
            onChange={(e) => {
              setOperatorId(e.target.value);
              if (e.target.value) setCompanyId("");
            }}
            aria-label={labels.network}
            className={field}
          >
            <option value="">{labels.none}</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {overrides.map(([text, value, set]) => (
          <label key={text} className="block text-sm">
            <span className={label}>{text}</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={value}
              onChange={(e) => set(e.target.value)}
              aria-label={text}
              className={`num ${field} w-24`}
            />
          </label>
        ))}
        <label className="block grow text-sm">
          <span className={label}>{labels.note}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={labels.note}
            className={`${field} w-full`}
          />
        </label>
        <button
          type="submit"
          disabled={pending || !planId || (!companyId && !operatorId)}
          data-testid="assign-plan"
          className="rounded border border-accent px-3 py-1 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          {labels.assign}
        </button>
      </div>

      {error && (
        <p className="text-[13px] text-down" data-testid="assign-error">
          {error}
        </p>
      )}
    </form>
  );
}
