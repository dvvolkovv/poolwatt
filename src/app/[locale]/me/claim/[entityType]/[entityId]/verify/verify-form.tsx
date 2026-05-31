"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyClaim } from "./actions";

type Props = {
  entityType: "PRODUCER" | "CHARGER_OPERATOR";
  entityId: string;
  locale: string;
  labels: { code: string; submit: string };
};

export function VerifyForm({ entityType, entityId, locale, labels }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await verifyClaim({ entityType, entityId, code });
      if (result.ok) {
        const cabinetPath = entityType === "PRODUCER"
          ? `/${locale}/me/producer/${entityId}`
          : `/${locale}/me/charger-operator/${entityId}`;
        router.push(`${cabinetPath}?claimed=1`);
      } else {
        setError(result.formError ?? "Verification failed.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="code" className="block text-sm font-medium mb-1">{labels.code}</label>
        <input
          id="code"
          type="text"
          required
          pattern="\d{6}"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card text-2xl tracking-[0.5em] text-center font-mono"
        />
      </div>
      {error && <p className="text-sm text-down">{error}</p>}
      <button
        type="submit"
        disabled={pending || code.length !== 6}
        className="px-5 py-2.5 rounded-full font-semibold text-sm bg-accent text-accent-foreground disabled:opacity-50"
      >
        {labels.submit}
      </button>
    </form>
  );
}
