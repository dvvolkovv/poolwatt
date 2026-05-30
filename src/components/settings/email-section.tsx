"use client";

import { useActionState } from "react";
import { addOrChangeEmailAction, type FieldError } from "@/app/[locale]/me/settings/actions";

const init: FieldError = {};

export function EmailSection({
  currentEmail,
  emailVerified,
  labels,
}: {
  currentEmail: string | null;
  emailVerified: boolean;
  labels: {
    title: string;
    none: string;
    pendingNote: string;
    addLabel: string;
    addPlaceholder: string;
    submit: string;
    submitting: string;
    successPending: string;
  };
}) {
  const [state, action, pending] = useActionState(addOrChangeEmailAction, init);

  return (
    <section className="border-t border-hairline pt-8">
      <h2 className="text-[18px] font-semibold mb-1">{labels.title}</h2>
      {currentEmail ? (
        <p className="text-sm text-muted mb-4">
          {currentEmail}{" "}
          <span
            className={
              "ml-2 text-[10px] uppercase tracking-[0.16em] " +
              (emailVerified ? "text-up" : "text-muted")
            }
          >
            ({emailVerified ? "verified" : "pending"})
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted mb-4">{labels.none}</p>
      )}

      <form action={action} className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-start max-w-md">
        <div className="flex-1">
          <input
            type="email"
            name="email"
            required
            placeholder={labels.addPlaceholder}
            aria-label={labels.addLabel}
            className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-foreground text-[14px] focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {state.fieldErrors?.email && (
            <p className="mt-1 text-xs text-down">{state.fieldErrors.email}</p>
          )}
          {state.ok && (
            <p className="mt-1 text-xs text-up">{labels.successPending}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="border border-hairline hover:border-accent rounded-md px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.12em] disabled:opacity-60 transition-colors"
        >
          {pending ? labels.submitting : labels.submit}
        </button>
      </form>
      {!emailVerified && currentEmail == null && (
        <p className="mt-3 text-[12px] text-muted leading-relaxed">
          {labels.pendingNote}
        </p>
      )}
    </section>
  );
}
