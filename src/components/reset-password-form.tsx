"use client";

import { useActionState } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";
import { resetPasswordAction, type ResetState } from "@/app/[locale]/reset-password/actions";

const init: ResetState = {};

export function ResetPasswordForm({
  token,
  labels,
}: {
  token: string;
  labels: {
    title: string;
    subtitle: string;
    newLabel: string;
    submit: string;
    submitting: string;
    success: string;
    backToLogin: string;
  };
}) {
  const locale = useLocale();
  const [state, action, pending] = useActionState(resetPasswordAction, init);

  if (state.ok) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-3">{labels.success}</h1>
        <Link
          href={`/${locale}/login`}
          className="mt-4 inline-flex items-center px-5 py-3 rounded-full font-semibold text-[13px] uppercase tracking-[0.18em] bg-accent text-accent-foreground glow-accent transition-all hover:brightness-110"
        >
          {labels.backToLogin}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="w-full max-w-sm space-y-6">
      <input type="hidden" name="token" value={token} />

      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em]">{labels.title}</h1>
        <p className="mt-2 text-sm text-muted">{labels.subtitle}</p>
      </div>

      <div>
        <label htmlFor="newPassword" className="block text-[11px] uppercase tracking-[0.18em] text-muted mb-2">
          {labels.newLabel}
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-foreground text-[15px] focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {state.fieldErrors?.newPassword && (
          <p className="mt-1 text-xs text-down">{state.fieldErrors.newPassword}</p>
        )}
        {state.formError && <p className="mt-1 text-xs text-down">{state.formError}</p>}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-accent text-accent-foreground rounded-full px-5 py-3 font-semibold uppercase tracking-[0.18em] text-[13px] glow-accent transition-all hover:brightness-110 disabled:opacity-60"
      >
        {pending ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
