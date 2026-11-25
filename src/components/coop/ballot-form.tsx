"use client";

// US-21 — one member, one vote, changeable until the vote closes.

import { useState, useTransition } from "react";
import { castBallotAction } from "@/app/[locale]/me/coop/actions";

export function BallotForm({
  voteId,
  options,
  myOption,
  labels,
}: {
  voteId: string;
  options: string[];
  myOption: string | null;
  labels: { cast: string; change: string; yourVote: string; noScore: string };
}) {
  const [option, setOption] = useState(myOption ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-2"
      data-testid={`ballot-${voteId}`}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await castBallotAction({ voteId, option });
          if (!r.ok) setError(r.formError);
        });
      }}
    >
      <div className="flex flex-col gap-1.5 text-sm">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-2">
            <input
              type="radio"
              name={`vote-${voteId}`}
              value={o}
              checked={option === o}
              onChange={() => setOption(o)}
            />
            <span>{o}</span>
            {myOption === o && (
              <span className="text-[11px] uppercase tracking-wider text-accent">
                {labels.yourVote}
              </span>
            )}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || option === "" || option === myOption}
          data-testid={`cast-${voteId}`}
          className="rounded border border-accent px-3 py-1 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          {myOption ? labels.change : labels.cast}
        </button>
        {/* US-21 — the score appears only after the vote closes, so the last
            member to vote cannot read the outcome off the page first. */}
        <span className="text-[12px] text-muted">{labels.noScore}</span>
      </div>

      {error && (
        <p className="text-[13px] text-down" data-testid="ballot-error">
          {error}
        </p>
      )}
    </form>
  );
}
