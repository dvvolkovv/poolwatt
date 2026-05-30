"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const RENEWABLES = ["SOLAR", "WIND", "HYDRO", "BIOMASS", "GEOTHERMAL", "HYBRID"] as const;

type Props = {
  locale: string;
  initialCountry: string;
  initialRenewable: string;
  countryOptions: string[]; // ISO-2 codes that have at least one APPROVED contractor
  labels: {
    country: string;
    renewable: string;
    all: string;
    apply: string;
    clear: string;
    renewableLabels: Record<string, string>;
  };
};

export function ContractorFilters({
  locale,
  initialCountry,
  initialRenewable,
  countryOptions,
  labels,
}: Props) {
  const router = useRouter();
  const [country, setCountry] = useState(initialCountry);
  const [renewable, setRenewable] = useState(initialRenewable);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const qs = new URLSearchParams();
    if (country) qs.set("country", country);
    if (renewable) qs.set("renewable", renewable);
    const url = `/${locale}/contractors${qs.toString() ? `?${qs}` : ""}`;
    router.push(url);
  }

  function clear() {
    setCountry("");
    setRenewable("");
    router.push(`/${locale}/contractors`);
  }

  const hasFilters = country || renewable;

  return (
    <form onSubmit={apply} className="flex flex-wrap gap-2 items-center mb-6 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted">{labels.country}</span>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="border border-hairline rounded px-2 py-1 bg-card"
        >
          <option value="">{labels.all}</option>
          {countryOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-muted">{labels.renewable}</span>
        <select
          value={renewable}
          onChange={(e) => setRenewable(e.target.value)}
          className="border border-hairline rounded px-2 py-1 bg-card"
        >
          <option value="">{labels.all}</option>
          {RENEWABLES.map((r) => (
            <option key={r} value={r}>{labels.renewableLabels[r] ?? r}</option>
          ))}
        </select>
      </label>

      <button type="submit" className="px-3 py-1 bg-foreground text-bg rounded">{labels.apply}</button>
      {hasFilters && (
        <button type="button" onClick={clear} className="px-3 py-1 border border-hairline rounded">
          {labels.clear}
        </button>
      )}
    </form>
  );
}
