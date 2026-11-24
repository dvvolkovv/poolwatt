"use client";

import { useActionState } from "react";
import { setPasswordAction, type FieldError } from "@/app/[locale]/me/settings/actions";

const init: FieldError = {};

/** For accounts created through Taler ID, which start without a password. */
export function SetPasswordSection({
  username,
  labels,
}: {
  username: string;
  labels: { title: string; note: string; newLabel: string; submit: string; submitting: string };
}) {
  const [state, action, pending] = useActionState(setPasswordAction, init);

  return (
    <section className="border-t border-hairline pt-8">
      <h2 className="text-[18px] font-semibold mb-1">{labels.title}</h2>
      <p className="text-sm text-muted mb-4">{labels.note}</p>
      <form action={action} className="max-w-md space-y-3">
        {/* Lets password managers save the pair. */}
        <input type="hidden" name="username" autoComplete="username" value={username} />
        <div>
          <label
            htmlFor="new-password"
            className="block text-[11px] uppercase tracking-[0.18em] text-muted mb-2"
          >
            {labels.newLabel}
          </label>
          <input
            id="new-password"
            type="password"
            name="newPassword"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-foreground text-[14px] focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {state.fieldErrors?.newPassword && (
            <p className="mt-1 text-xs text-down">{state.fieldErrors.newPassword}</p>
          )}
        </div>
        {state.formError && <p className="text-xs text-down">{state.formError}</p>}
        <button
          type="submit"
          disabled={pending}
          className="border border-hairline hover:border-accent rounded-md px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.12em] disabled:opacity-60 transition-colors"
        >
          {pending ? labels.submitting : labels.submit}
        </button>
      </form>
    </section>
  );
}
