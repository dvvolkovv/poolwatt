"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitClaim } from "./actions";

type Props = {
  entityType: "PRODUCER" | "CHARGER_OPERATOR";
  entityId: string;
  locale: string;
  website: string;
  labels: { email: string; submit: string; domainHint: string };
};

export function ClaimForm({ entityType, entityId, locale, website, labels }: Props) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitClaim({ entityType, entityId, email });
      if (result.ok) {
        router.push(`/${locale}/me/claim/${entityType}/${entityId}/verify`);
      } else {
        setError(result.fieldErrors?.email ?? result.formError ?? "Submission failed.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">{labels.email}</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card"
        />
        <p className="text-xs text-muted mt-1">{labels.domainHint}</p>
      </div>
      {error && <p className="text-sm text-down">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="px-5 py-2.5 rounded-full font-semibold text-sm bg-accent text-accent-foreground disabled:opacity-50"
      >
        {labels.submit}
      </button>
    </form>
  );
}
