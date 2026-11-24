"use client";

// US-03 — "Выдача API-ключа объекта". The plaintext lives only in this
// component's state, for as long as the producer keeps the page open.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issueKey, revokeKey } from "@/app/[locale]/me/listing/[companyId]/assets/actions";

export type AssetKeysLabels = {
  keys: string;
  keysHelp: string;
  noKeys: string;
  issueKey: string;
  issuing: string;
  keyLabel: string;
  revoke: string;
  revoked: string;
  lastUsed: string;
  never: string;
  keyOnce: string;
};

export type KeyRow = {
  id: string;
  prefix: string;
  label: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export function AssetKeys({
  assetId,
  keys,
  labels,
}: {
  assetId: string;
  keys: KeyRow[];
  labels: AssetKeysLabels;
}) {
  const router = useRouter();
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function onIssue() {
    setError(null);
    setBusy(true);
    const result = await issueKey(assetId, label.trim() || null);
    setBusy(false);
    if (!result.ok) {
      setError(result.formError ?? "Key issue failed.");
      return;
    }
    setPlaintext(result.plaintext ?? null);
    setLabel("");
    startTransition(() => router.refresh());
  }

  async function onRevoke(keyId: string) {
    setError(null);
    setBusy(true);
    const result = await revokeKey(assetId, keyId);
    setBusy(false);
    if (!result.ok) {
      setError(result.formError ?? "Revoke failed.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <h4 className="text-[12px] uppercase tracking-[0.14em] text-muted">{labels.keys}</h4>
      <p className="mb-3 mt-1 max-w-[80ch] text-[12px] text-muted">{labels.keysHelp}</p>

      {plaintext && (
        <div className="mb-3 rounded border border-accent/60 bg-card p-3">
          <p className="mb-1 text-[12px] text-accent">{labels.keyOnce}</p>
          <code className="num block break-all text-[13px]">{plaintext}</code>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="mb-3 text-[13px] text-muted">{labels.noKeys}</p>
      ) : (
        <ul className="mb-3 text-[13px]">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline py-1.5">
              <span className="num">
                {k.prefix}… {k.label && <span className="text-muted">· {k.label}</span>}
              </span>
              <span className="flex items-center gap-4 text-[12px] text-muted">
                <span className="num">
                  {labels.lastUsed}: {k.lastUsedAt ?? labels.never}
                </span>
                {k.revokedAt ? (
                  <span>{labels.revoked}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRevoke(k.id)}
                    disabled={busy}
                    className="underline hover:text-red-400 disabled:opacity-50"
                  >
                    {labels.revoke}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={labels.keyLabel}
          maxLength={100}
          className="min-w-[14rem] flex-1 rounded border border-hairline bg-bg px-3 py-1.5 text-[13px]"
        />
        <button
          type="button"
          onClick={onIssue}
          disabled={busy}
          className="rounded border border-hairline px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-50"
        >
          {busy ? labels.issuing : labels.issueKey}
        </button>
      </div>

      {error && <p className="mt-2 text-[13px] text-red-400">{error}</p>}
    </div>
  );
}
