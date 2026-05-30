"use client";

import { useActionState } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";
import { forgotPasswordAction, type ForgotState } from "@/app/[locale]/forgot-password/actions";

const init: ForgotState = {};

export function ForgotPasswordForm({
  labels,
}: {
  labels: {
    title: string;
    subtitle: string;
    identifierLabel: string;
    identifierPlaceholder: string;
    submit: string;
    submitting: string;
    success: string;
    noEmail: string;
    unknown: string;
    backToLogin: string;
  };
}) {
  const locale = useLocale();
  const [state, action, pending] = useActionState(forgotPasswordAction, init);

  return (
    <form action={action} className="w-full max-w-sm space-y-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em]">{labels.title}</h1>
        <p className="mt-2 text-sm text-muted">{labels.subtitle}</p>
      </div>

      <div>
        <label htmlFor="identifier" className="block text-[11px] uppercase tracking-[0.18em] text-muted mb-2">
          {labels.identifierLabel}
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          required
          autoComplete="username"
          placeholder={labels.identifierPlaceholder}
          className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-foreground text-[15px] focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {state.formError && <p className="text-sm text-down">{state.formError}</p>}
      {state.status === "ok" && <p className="text-sm text-up">{labels.success}</p>}
      {state.status === "no-email" && <p className="text-sm text-down">{labels.noEmail}</p>}
      {state.status === "unknown" && <p className="text-sm text-muted">{labels.unknown}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-accent text-accent-foreground rounded-full px-5 py-3 font-semibold uppercase tracking-[0.18em] text-[13px] glow-accent transition-all hover:brightness-110 disabled:opacity-60"
      >
        {pending ? labels.submitting : labels.submit}
      </button>

      <p className="text-sm text-muted text-center">
        <Link href={`/${locale}/login`} className="text-accent hover:underline">
          ‹ {labels.backToLogin}
        </Link>
      </p>
    </form>
  );
}
