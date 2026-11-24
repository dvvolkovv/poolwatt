"use client";

// US-01 — "Форма с реквизитами, страной". The company is registered first so
// the draft application it opens has somewhere to keep documents.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerCompany } from "@/app/[locale]/me/listing/actions";

const TYPES = ["PRODUCER", "WHOLESALE", "COOPERATIVE", "OPERATOR"] as const;

export type CompanyFormLabels = {
  title: string;
  newCompany: string;
  legalName: string;
  country: string;
  regNumber: string;
  vatNumber: string;
  type: string;
  website: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  submit: string;
  cancel: string;
  saving: string;
  typeNames: Record<string, string>;
};

export function CompanyForm({
  locale,
  labels,
  defaultCountry,
}: {
  locale: string;
  labels: CompanyFormLabels;
  defaultCountry: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
        + {labels.newCompany}
      </button>
    );
  }

  async function onSubmit(formData: FormData) {
    setFieldErrors({});
    setFormError(null);
    const input = {
      legalName: String(formData.get("legalName") ?? ""),
      country: String(formData.get("country") ?? ""),
      regNumber: String(formData.get("regNumber") ?? ""),
      vatNumber: String(formData.get("vatNumber") ?? ""),
      type: String(formData.get("type") ?? "PRODUCER") as (typeof TYPES)[number],
      website: String(formData.get("website") ?? ""),
      contactName: String(formData.get("contactName") ?? ""),
      contactEmail: String(formData.get("contactEmail") ?? ""),
      contactPhone: String(formData.get("contactPhone") ?? ""),
    };
    const result = await registerCompany(input);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.formError ?? null);
      return;
    }
    startTransition(() => {
      router.push(`/${locale}/me/listing/${result.companyId}`);
    });
  }

  return (
    <form
      action={(fd) => {
        startTransition(async () => {
          await onSubmit(fd);
        });
      }}
      className="rounded-lg border border-hairline bg-card p-4 md:p-6"
    >
      <h2 className="mb-4 text-[15px] font-semibold">{labels.title}</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <Field name="legalName" label={labels.legalName} error={fieldErrors.legalName} required />
        <Field
          name="country"
          label={labels.country}
          error={fieldErrors.country}
          required
          defaultValue={defaultCountry}
          maxLength={2}
          className="num uppercase"
        />
        <Field name="regNumber" label={labels.regNumber} error={fieldErrors.regNumber} required className="num" />
        <Field name="vatNumber" label={labels.vatNumber} error={fieldErrors.vatNumber} className="num" />

        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.type}
          </span>
          <select
            name="type"
            defaultValue="PRODUCER"
            className="w-full rounded border border-hairline bg-bg px-3 py-2 text-sm"
          >
            {TYPES.map((v) => (
              <option key={v} value={v}>
                {labels.typeNames[v] ?? v}
              </option>
            ))}
          </select>
        </label>

        <Field name="website" label={labels.website} error={fieldErrors.website} />
        <Field name="contactName" label={labels.contactName} error={fieldErrors.contactName} />
        <Field name="contactEmail" label={labels.contactEmail} error={fieldErrors.contactEmail} type="email" />
        <Field name="contactPhone" label={labels.contactPhone} error={fieldErrors.contactPhone} />
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
      <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">{label}</span>
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
