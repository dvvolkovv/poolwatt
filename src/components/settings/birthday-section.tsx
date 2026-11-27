"use client";

// §42's birthday gift, from the person's side: day and month, given because
// they want the gift, not because we asked for a document.

import { useActionState } from "react";
import { updateBirthdayAction } from "@/app/[locale]/me/settings/actions";

type Props = {
  currentDay: number | null;
  currentMonth: number | null;
  labels: { title: string; help: string; day: string; month: string; submit: string; success: string };
};

export function BirthdaySection({ currentDay, currentMonth, labels }: Props) {
  const [state, action, pending] = useActionState(updateBirthdayAction, {});

  return (
    <section className="border-t border-hairline pt-8" data-testid="birthday-section">
      <h2 className="mb-2 text-[18px] font-semibold">{labels.title}</h2>
      <p className="mb-4 max-w-md text-[13px] text-muted">{labels.help}</p>
      <form action={action} className="flex max-w-md flex-wrap items-start gap-3">
        <label className="text-[13px]">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-muted">
            {labels.day}
          </span>
          <input
            name="birthDay"
            type="number"
            min={1}
            max={31}
            defaultValue={currentDay ?? ""}
            aria-label={labels.day}
            className="num w-20 rounded-md border border-hairline bg-card px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <label className="text-[13px]">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-muted">
            {labels.month}
          </span>
          <input
            name="birthMonth"
            type="number"
            min={1}
            max={12}
            defaultValue={currentMonth ?? ""}
            aria-label={labels.month}
            className="num w-20 rounded-md border border-hairline bg-card px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="mt-6 rounded-md border border-hairline px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.12em] transition-colors hover:border-accent disabled:opacity-60"
        >
          {labels.submit}
        </button>
      </form>
      {state.fieldErrors?.birthday && (
        <p className="mt-1 text-xs text-down" data-testid="birthday-error">
          {state.fieldErrors.birthday}
        </p>
      )}
      {state.ok && (
        <p className="mt-1 text-xs text-up" data-testid="birthday-saved">
          {labels.success}
        </p>
      )}
    </section>
  );
}
