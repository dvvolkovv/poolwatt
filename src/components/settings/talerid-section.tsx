"use client";

import { useActionState } from "react";
import { linkTalerId } from "@/app/actions/talerid";
import { unlinkTalerIdAction, type FieldError } from "@/app/[locale]/me/settings/actions";
import { TalerIdSubmit } from "@/components/talerid-submit";

const init: FieldError = {};

export function TalerIdSection({
  locale,
  linked,
  hasPassword,
  justLinked,
  error,
  labels,
}: {
  locale: string;
  linked: boolean;
  hasPassword: boolean;
  justLinked: boolean;
  error: string | null;
  labels: {
    title: string;
    linked: string;
    notLinked: string;
    link: string;
    linkPending: string;
    unlink: string;
    unlinking: string;
    needsPassword: string;
    linkedNotice: string;
  };
}) {
  const [state, unlink, pending] = useActionState(unlinkTalerIdAction, init);
  const needsPassword = state.formError === "password_required";

  return (
    <section id="talerid" className="border-t border-hairline pt-8">
      <h2 className="text-[18px] font-semibold mb-1">{labels.title}</h2>
      <p className="text-sm text-muted mb-4">{linked ? labels.linked : labels.notLinked}</p>

      {error && (
        <p role="alert" className="text-sm text-down mb-4">
          {error}
        </p>
      )}
      {justLinked && linked && (
        <p role="status" className="text-xs text-up mb-4">
          {labels.linkedNotice}
        </p>
      )}

      {!linked && (
        <form action={linkTalerId} className="max-w-[260px]">
          <input type="hidden" name="locale" value={locale} />
          <TalerIdSubmit label={labels.link} pendingLabel={labels.linkPending} />
        </form>
      )}

      {linked && hasPassword && !needsPassword && (
        <form action={unlink}>
          <button
            type="submit"
            disabled={pending}
            className="border border-hairline hover:border-accent rounded-md px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.12em] disabled:opacity-60 transition-colors"
          >
            {pending ? labels.unlinking : labels.unlink}
          </button>
          {state.formError && <p className="mt-2 text-xs text-down">{state.formError}</p>}
        </form>
      )}

      {linked && (!hasPassword || needsPassword) && (
        <p className="text-[12px] text-muted leading-relaxed max-w-md">{labels.needsPassword}</p>
      )}
    </section>
  );
}
