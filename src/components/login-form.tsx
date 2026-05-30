"use client";

import { useActionState } from "react";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { loginAction, type LoginFormState } from "@/app/[locale]/login/actions";

const initial: LoginFormState = {};

export function LoginForm({
  labels,
}: {
  labels: {
    title: string;
    subtitle: string;
    usernameLabel: string;
    usernamePlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    submit: string;
    submitting: string;
    noAccount: string;
    register: string;
    forgotPassword: string;
  };
}) {
  const locale = useLocale();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? `/${locale}/me`;
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <form action={action} className="w-full max-w-sm space-y-6">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em]">{labels.title}</h1>
        <p className="mt-2 text-sm text-muted">{labels.subtitle}</p>
      </div>

      <div>
        <label htmlFor="username" className="block text-[11px] uppercase tracking-[0.18em] text-muted mb-2">
          {labels.usernameLabel}
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          placeholder={labels.usernamePlaceholder}
          className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-foreground text-[15px] focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {state.fieldErrors?.username && (
          <p className="mt-1 text-xs text-down">{state.fieldErrors.username}</p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-[11px] uppercase tracking-[0.18em] text-muted mb-2">
          {labels.passwordLabel}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder={labels.passwordPlaceholder}
          className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-foreground text-[15px] focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {state.fieldErrors?.password && (
          <p className="mt-1 text-xs text-down">{state.fieldErrors.password}</p>
        )}
      </div>

      {state.formError && <p className="text-sm text-down">{state.formError}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-accent text-accent-foreground rounded-full px-5 py-3 font-semibold uppercase tracking-[0.18em] text-[13px] glow-accent transition-all hover:brightness-110 disabled:opacity-60"
      >
        {pending ? labels.submitting : labels.submit}
      </button>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>
          {labels.noAccount}{" "}
          <Link href={`/${locale}/register`} className="text-accent hover:underline">
            {labels.register}
          </Link>
        </span>
        <Link href={`/${locale}/forgot-password`} className="text-muted hover:text-foreground">
          {labels.forgotPassword}
        </Link>
      </div>
    </form>
  );
}
