"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { expressInterest } from "@/app/[locale]/me/contractor/[id]/requests/actions";

type Props = {
  buildRequestId: string;
  contractorId: string;
  labels: {
    expressInterest: string;
    messageLabel: string;
    messagePlaceholder: string;
    submit: string;
    submitting: string;
  };
};

export function ExpressInterestForm({ buildRequestId, contractorId, labels }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-foreground text-bg rounded text-sm"
      >
        {labels.expressInterest}
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await expressInterest({ buildRequestId, contractorId, message: message || undefined });
          if (!r.ok) {
            setError(r.formError ?? r.fieldErrors?.message ?? "Failed");
          } else {
            router.refresh();
          }
        });
      }}
      className="border border-hairline rounded p-3 space-y-2"
    >
      <label className="block text-xs text-muted">{labels.messageLabel}</label>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        maxLength={500}
        placeholder={labels.messagePlaceholder}
        className="border border-hairline rounded px-2 py-1 w-full text-sm"
      />
      {error && <p className="text-red-600 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="px-3 py-1 bg-foreground text-bg rounded text-sm disabled:opacity-50">
          {pending ? labels.submitting : labels.submit}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-1 border border-hairline rounded text-sm">
          ×
        </button>
      </div>
    </form>
  );
}
