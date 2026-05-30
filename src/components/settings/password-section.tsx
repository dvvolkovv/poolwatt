"use client";

import { useActionState } from "react";
import { changePasswordAction, type FieldError } from "@/app/[locale]/me/settings/actions";

const init: FieldError = {};

export function PasswordSection({
  labels,
}: {
  labels: {
    title: string;
    currentLabel: string;
    newLabel: string;
    submit: string;
    submitting: string;
    success: string;
  };
}) {
  const [state, action, pending] = useActionState(changePasswordAction, init);

  return (
    <section className="border-t border-hairline pt-8">
      <h2 className="text-[18px] font-semibold mb-4">{labels.title}</h2>
      <form action={action} className="max-w-md space-y-3">
        <div>
          <label className="block text-[11px] uppercase tracking-[0.18em] text-muted mb-2">
            {labels.currentLabel}
          </label>
          <input
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
            className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-foreground text-[14px] focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {state.fieldErrors?.currentPassword && (
            <p className="mt-1 text-xs text-down">{state.fieldErrors.currentPassword}</p>
          )}
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-[0.18em] text-muted mb-2">
            {labels.newLabel}
          </label>
          <input
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
        {state.ok && <p className="text-xs text-up">{labels.success}</p>}
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
