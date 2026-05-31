"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { expressProducerInterest } from "./actions";

type Props = {
  producerId: string;
  buildRequestId: string;
  labels: { message: string; submit: string; submitting: string };
};

export function ExpressForm({ producerId, buildRequestId, labels }: Props) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await expressProducerInterest({ buildRequestId, producerId, message });
      if (r.ok) {
        router.refresh();
      } else {
        setError(r.formError ?? r.fieldErrors?.message ?? "Failed");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2 mt-3">
      <textarea
        rows={2}
        maxLength={2000}
        placeholder={labels.message}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="w-full px-3 py-2 rounded border border-hairline bg-card text-sm"
      />
      {error && <p className="text-xs text-down">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-accent text-accent-foreground disabled:opacity-50"
      >
        {pending ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
