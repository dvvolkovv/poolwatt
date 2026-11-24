"use client";

// US-03 — "Хочу подключить объект генерации к мониторингу": the card of §4
// (type, power, address, grid zone, guarantee of origin).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addAsset } from "@/app/[locale]/me/listing/[companyId]/assets/actions";

const KINDS = ["SOLAR", "WIND", "BIOGAS", "HYDRO", "STORAGE", "MIXED"] as const;

export type AssetFormLabels = {
  newAsset: string;
  title: string;
  kind: string;
  name: string;
  capacityKw: string;
  storageKwh: string;
  address: string;
  latitude: string;
  longitude: string;
  zone: string;
  meterId: string;
  goCertificateRef: string;
  submit: string;
  cancel: string;
  saving: string;
  kindNames: Record<string, string>;
};

export function AssetForm({
  companyId,
  zones,
  labels,
}: {
  companyId: string;
  zones: { id: string; code: string; name: string }[];
  labels: AssetFormLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("SOLAR");
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-accent px-4 py-2 text-sm text-accent hover:bg-accent/10"
      >
        + {labels.newAsset}
      </button>
    );
  }

  const needsStorage = kind === "STORAGE" || kind === "MIXED";
  const numberOrNull = (v: FormDataEntryValue | null) => {
    const s = String(v ?? "").trim().replace(",", ".");
    return s === "" ? null : Number(s);
  };

  async function onSubmit(formData: FormData) {
    setFieldErrors({});
    setFormError(null);
    const result = await addAsset(companyId, {
      kind,
      name: String(formData.get("name") ?? ""),
      capacityKw: numberOrNull(formData.get("capacityKw")) ?? 0,
      storageKwh: needsStorage ? numberOrNull(formData.get("storageKwh")) : null,
      address: String(formData.get("address") ?? ""),
      latitude: numberOrNull(formData.get("latitude")),
      longitude: numberOrNull(formData.get("longitude")),
      gridZoneId: String(formData.get("gridZoneId") ?? ""),
      meterId: String(formData.get("meterId") ?? ""),
      goCertificateRef: String(formData.get("goCertificateRef") ?? ""),
    });
    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.formError ?? null);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <form
      action={(fd) => startTransition(async () => void (await onSubmit(fd)))}
      className="rounded-lg border border-hairline bg-card p-4 md:p-6"
    >
      <h3 className="mb-4 text-[15px] font-semibold">{labels.title}</h3>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm">
          <Caption>{labels.kind}</Caption>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
            className="w-full rounded border border-hairline bg-bg px-3 py-2 text-sm"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {labels.kindNames[k] ?? k}
              </option>
            ))}
          </select>
        </label>

        <Field name="name" label={labels.name} error={fieldErrors.name} required />
        <Field
          name="capacityKw"
          label={labels.capacityKw}
          error={fieldErrors.capacityKw}
          required
          inputMode="decimal"
          className="num"
        />
        {needsStorage && (
          <Field
            name="storageKwh"
            label={labels.storageKwh}
            error={fieldErrors.storageKwh}
            inputMode="decimal"
            className="num"
          />
        )}

        <label className="block text-sm">
          <Caption>{labels.zone}</Caption>
          <select
            name="gridZoneId"
            className="w-full rounded border border-hairline bg-bg px-3 py-2 text-sm"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.code} — {z.name}
              </option>
            ))}
          </select>
        </label>

        <Field name="address" label={labels.address} error={fieldErrors.address} />
        <Field name="latitude" label={labels.latitude} error={fieldErrors.latitude} inputMode="decimal" className="num" />
        <Field name="longitude" label={labels.longitude} error={fieldErrors.longitude} inputMode="decimal" className="num" />
        <Field name="meterId" label={labels.meterId} error={fieldErrors.meterId} className="num" />
        <Field
          name="goCertificateRef"
          label={labels.goCertificateRef}
          error={fieldErrors.goCertificateRef}
        />
      </div>

      {formError && <p className="mt-4 text-sm text-red-400">{formError}</p>}

      <div className="mt-5 flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          {pending ? labels.saving : labels.submit}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-hairline px-4 py-2 text-sm text-muted"
        >
          {labels.cancel}
        </button>
      </div>
    </form>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
      {children}
    </span>
  );
}

function Field({
  name,
  label,
  error,
  className = "",
  ...rest
}: {
  name: string;
  label: string;
  error?: string;
  className?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm">
      <Caption>{label}</Caption>
      <input
        name={name}
        className={`w-full rounded border bg-bg px-3 py-2 text-sm ${
          error ? "border-red-400" : "border-hairline"
        } ${className}`}
        {...rest}
      />
      {error && <span className="mt-1 block text-[12px] text-red-400">{error}</span>}
    </label>
  );
}
