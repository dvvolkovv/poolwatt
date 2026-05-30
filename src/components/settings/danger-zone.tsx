"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useEffect } from "react";
import { deleteAccountAction, type FieldError } from "@/app/[locale]/me/settings/actions";

const init: FieldError = {};

export function DangerZone({
  username,
  labels,
}: {
  username: string;
  labels: {
    title: string;
    warning: string;
    confirmLabel: string;
    submit: string;
    submitting: string;
  };
}) {
  const [state, action, pending] = useActionState(deleteAccountAction, init);
  const router = useRouter();
  const locale = useLocale();

  // The server action returns ok:true after destroying the user; client-side
  // we then nuke the session cookie (Auth.js does this server-side too — but
  // a hard reload to the landing makes the UI catch up immediately).
  useEffect(() => {
    if (state.ok) {
      window.location.assign(`/${locale}`);
    }
  }, [state.ok, locale, router]);

  return (
    <section className="border-t border-down/30 pt-8 mt-8">
      <h2 className="text-[18px] font-semibold mb-2 text-down">{labels.title}</h2>
      <p className="text-sm text-muted mb-4">{labels.warning}</p>
      <form action={action} className="max-w-md space-y-3">
        <div>
          <label className="block text-[11px] uppercase tracking-[0.18em] text-muted mb-2">
            {labels.confirmLabel.replace("{username}", username)}
          </label>
          <input
            type="text"
            name="confirm"
            required
            autoComplete="off"
            placeholder={username}
            className="w-full bg-card border border-down/40 rounded-md px-3 py-2 text-foreground text-[14px] focus:outline-none focus:ring-1 focus:ring-down"
          />
          {state.fieldErrors?.confirm && (
            <p className="mt-1 text-xs text-down">{state.fieldErrors.confirm}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="border border-down text-down hover:bg-down hover:text-bg rounded-md px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.12em] disabled:opacity-60 transition-colors"
        >
          {pending ? labels.submitting : labels.submit}
        </button>
      </form>
    </section>
  );
}
