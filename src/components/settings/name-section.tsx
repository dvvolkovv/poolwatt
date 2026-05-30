"use client";

import { useActionState } from "react";
import { updateNameAction } from "@/app/[locale]/me/settings/actions";

type Props = {
  currentName: string | null;
  labels: { title: string; placeholder: string; submit: string; success: string };
};

export function NameSection({ currentName, labels }: Props) {
  const [state, action, pending] = useActionState(updateNameAction, {});

  return (
    <section className="border-t border-hairline pt-8">
      <h2 className="text-[18px] font-semibold mb-4">{labels.title}</h2>
      <form action={action} className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-start max-w-md">
        <div className="flex-1">
          <input
            name="name"
            type="text"
            defaultValue={currentName ?? ""}
            placeholder={labels.placeholder}
            className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-foreground text-[14px] focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {state.fieldErrors?.name && (
            <p className="mt-1 text-xs text-down">{state.fieldErrors.name}</p>
          )}
          {state.ok && (
            <p className="mt-1 text-xs text-up">{labels.success}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="border border-hairline hover:border-accent rounded-md px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.12em] disabled:opacity-60 transition-colors"
        >
          {labels.submit}
        </button>
      </form>
    </section>
  );
}
