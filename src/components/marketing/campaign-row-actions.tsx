"use client";

// Starting, pausing and ending a campaign, and topping its budget up — §42.

import { useState, useTransition } from "react";
import {
  setCampaignBudgetAction,
  setCampaignStatusAction,
} from "@/app/[locale]/me/charger-operator/[id]/campaigns/actions";

export function CampaignRowActions({
  campaignId,
  status,
  budgetKwh,
  labels,
}: {
  campaignId: string;
  status: string;
  budgetKwh: number;
  labels: { start: string; pause: string; end: string; topUp: string; newBudget: string };
}) {
  const [budget, setBudget] = useState(String(budgetKwh));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; formError?: string }>) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.formError ?? "Could not do that.");
    });

  const button = (label: string, next: "ACTIVE" | "PAUSED" | "ENDED", testId: string) => (
    <button
      type="button"
      disabled={pending}
      data-testid={testId}
      onClick={() => run(() => setCampaignStatusAction({ campaignId, status: next }))}
      className="rounded border border-hairline px-2 py-0.5 text-[12px] hover:border-accent disabled:opacity-50"
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status !== "ACTIVE" && status !== "ENDED" && button(labels.start, "ACTIVE", "start-campaign")}
        {status === "ACTIVE" && button(labels.pause, "PAUSED", "pause-campaign")}
        {status !== "ENDED" && button(labels.end, "ENDED", "end-campaign")}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.newBudget}
          </span>
          <input
            type="number"
            min={0.001}
            step={0.001}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            aria-label={labels.newBudget}
            className="num w-32 rounded border border-hairline bg-bg px-2 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={pending}
          data-testid="top-up-budget"
          onClick={() =>
            run(() => setCampaignBudgetAction({ campaignId, budgetKwh: Number(budget) }))
          }
          className="rounded border border-hairline px-2 py-1 text-[12px] hover:border-accent disabled:opacity-50"
        >
          {labels.topUp}
        </button>
      </div>
      {error && <p className="text-[12px] text-down">{error}</p>}
    </div>
  );
}
