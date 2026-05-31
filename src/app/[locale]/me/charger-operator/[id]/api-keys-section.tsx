"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createChargerOperatorApiKey, revokeChargerOperatorApiKey } from "../actions";

type KeyRow = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type Props = {
  operatorId: string;
  keys: KeyRow[];
  labels: {
    sectionTitle: string;
    help: string;
    labelField: string;
    labelPlaceholder: string;
    generate: string;
    revoke: string;
    revokeConfirm: string;
    revoked: string;
    active: string;
    neverUsed: string;
    lastUsedPrefix: string;
    plaintextHeading: string;
    plaintextSubtitle: string;
    copy: string;
    copied: string;
    dismiss: string;
    empty: string;
    createdPrefix: string;
    endpointHint: string;
  };
};

export function ApiKeysSection({ operatorId, keys, labels }: Props) {
  const [label, setLabel] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [justCreated, setJustCreated] = useState<{ plaintext: string; id: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function generate(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const r = await createChargerOperatorApiKey({ operatorId, label });
      if (r.ok) {
        setJustCreated({ plaintext: r.plaintext, id: r.id });
        setLabel("");
        router.refresh();
      } else {
        setErrors(r.fieldErrors ?? { _form: r.formError ?? "Failed." });
      }
    });
  }

  function revoke(keyId: string) {
    if (!confirm(labels.revokeConfirm)) return;
    startTransition(async () => {
      await revokeChargerOperatorApiKey({ keyId });
      router.refresh();
    });
  }

  async function copyPlaintext() {
    if (!justCreated) return;
    await navigator.clipboard.writeText(justCreated.plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{labels.sectionTitle}</h2>
        <p className="text-xs text-muted mt-1">{labels.help}</p>
        <pre className="text-[11px] text-muted mt-2 px-3 py-2 bg-card-alt rounded border border-hairline overflow-x-auto">
{labels.endpointHint}{"\n"}POST /api/v1/charger-operators/{operatorId}/price{"\n"}Authorization: Bearer pwco_…{"\n"}{`{ "pricePerKwh": 0.42, "currency": "EUR" }`}
        </pre>
      </div>

      {justCreated && (
        <div className="p-4 rounded-xl border border-accent/40 bg-accent/5 space-y-2">
          <div className="text-sm font-semibold text-foreground">{labels.plaintextHeading}</div>
          <div className="text-xs text-muted">{labels.plaintextSubtitle}</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded bg-card border border-hairline text-[12px] font-mono break-all">
              {justCreated.plaintext}
            </code>
            <button
              type="button"
              onClick={copyPlaintext}
              className="px-3 py-2 text-[11px] uppercase tracking-wider rounded border border-hairline hover:bg-card-alt"
            >
              {copied ? labels.copied : labels.copy}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setJustCreated(null)}
            className="text-xs text-muted hover:text-foreground"
          >
            {labels.dismiss}
          </button>
        </div>
      )}

      <form onSubmit={generate} className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="apiKeyLabel" className="block text-sm font-medium mb-1">
            {labels.labelField}
          </label>
          <input
            id="apiKeyLabel"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={labels.labelPlaceholder}
            maxLength={80}
            className="w-full px-3 py-2 rounded border border-hairline bg-card"
          />
          {errors.label && <p className="text-xs text-down mt-1">{errors.label}</p>}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-full font-semibold text-sm bg-accent text-accent-foreground disabled:opacity-50"
        >
          {labels.generate}
        </button>
      </form>
      {errors._form && <p className="text-sm text-down">{errors._form}</p>}

      <div className="space-y-2">
        {keys.length === 0 && (
          <p className="text-xs text-muted italic">{labels.empty}</p>
        )}
        {keys.map((k) => {
          const isRevoked = !!k.revokedAt;
          return (
            <div
              key={k.id}
              className={`flex items-center justify-between gap-3 px-3 py-2 rounded border ${
                isRevoked ? "border-hairline opacity-50" : "border-hairline"
              }`}
            >
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground truncate">{k.label}</div>
                <div className="text-[11px] text-muted">
                  {labels.createdPrefix} <span className="num">{new Date(k.createdAt).toLocaleDateString()}</span>
                  {" · "}
                  {k.lastUsedAt ? (
                    <>
                      {labels.lastUsedPrefix}{" "}
                      <span className="num">{new Date(k.lastUsedAt).toLocaleString()}</span>
                    </>
                  ) : (
                    <span className="italic">{labels.neverUsed}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    isRevoked ? "bg-card-alt text-muted" : "bg-green/15 text-green"
                  }`}
                >
                  ● {isRevoked ? labels.revoked : labels.active}
                </span>
                {!isRevoked && (
                  <button
                    type="button"
                    onClick={() => revoke(k.id)}
                    disabled={pending}
                    className="text-[11px] text-muted hover:text-down border border-hairline px-2 py-1 rounded disabled:opacity-50"
                  >
                    {labels.revoke}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
