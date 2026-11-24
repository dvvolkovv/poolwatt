"use client";

// §30 "Правила продажи" — the split the dispatcher applies to every validated
// interval. US-28 asks for exactly this, minus the storage reserve.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSaleRules } from "@/app/[locale]/me/listing/[companyId]/assets/actions";

export type SaleRulesLabels = {
  rules: string;
  rulesHelp: string;
  minSalePrice: string;
  shareToMarket: string;
  shareToStorage: string;
  shareToSelf: string;
  saveRules: string;
  saving: string;
  saved: string;
};

export function SaleRulesForm({
  assetId,
  initial,
  labels,
}: {
  assetId: string;
  initial: {
    minSalePrice: number | null;
    shareToMarketPct: number;
    shareToStoragePct: number;
    shareToSelfPct: number;
  };
  labels: SaleRulesLabels;
}) {
  const router = useRouter();
  const [market, setMarket] = useState(initial.shareToMarketPct);
  const [storage, setStorage] = useState(initial.shareToStoragePct);
  const [self, setSelf] = useState(initial.shareToSelfPct);
  const [price, setPrice] = useState(initial.minSalePrice?.toString() ?? "");
  const [state, setState] = useState<"idle" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sum = market + storage + self;

  async function onSave() {
    setError(null);
    setState("idle");
    const parsedPrice = price.trim().replace(",", ".");
    const result = await saveSaleRules(assetId, {
      minSalePrice: parsedPrice === "" ? null : Number(parsedPrice),
      shareToMarketPct: market,
      shareToStoragePct: storage,
      shareToSelfPct: self,
    });
    if (!result.ok) {
      setError(result.formError ?? "Save failed.");
      return;
    }
    setState("saved");
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <h4 className="text-[12px] uppercase tracking-[0.14em] text-muted">{labels.rules}</h4>
      <p className="mb-3 mt-1 max-w-[80ch] text-[12px] text-muted">{labels.rulesHelp}</p>

      <div className="flex flex-wrap items-end gap-3">
        <Num label={labels.minSalePrice} value={price} onChange={setPrice} width="7rem" />
        <Num label={labels.shareToMarket} value={String(market)} onChange={(v) => setMarket(Number(v) || 0)} width="5rem" />
        <Num label={labels.shareToStorage} value={String(storage)} onChange={(v) => setStorage(Number(v) || 0)} width="5rem" />
        <Num label={labels.shareToSelf} value={String(self)} onChange={(v) => setSelf(Number(v) || 0)} width="5rem" />
        <button
          type="button"
          onClick={onSave}
          disabled={pending || sum !== 100}
          className="rounded border border-hairline px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-50"
        >
          {pending ? labels.saving : labels.saveRules}
        </button>
        {sum !== 100 && <span className="num text-[12px] text-red-400">Σ {sum} ≠ 100</span>}
        {state === "saved" && <span className="text-[12px] text-accent">{labels.saved}</span>}
      </div>

      {error && <p className="mt-2 text-[13px] text-red-400">{error}</p>}
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  width,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      <input
        value={value}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        style={{ width }}
        className="num rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
      />
    </label>
  );
}
