"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProducerProfile } from "../actions";

type Props = {
  producerId: string;
  initial: {
    description: string | null;
    founded: number | null;
    employees: string | null;
    website: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    ceo: string | null;
    stockTicker: string | null;
  };
  labels: {
    sectionTitle: string;
    description: string;
    founded: string;
    employees: string;
    website: string;
    email: string;
    phone: string;
    address: string;
    ceo: string;
    stockTicker: string;
    submit: string;
    saved: string;
  };
};

export function ProfileForm({ producerId, initial, labels }: Props) {
  const [description, setDescription] = useState(initial.description ?? "");
  const [founded, setFounded] = useState<string>(initial.founded?.toString() ?? "");
  const [employees, setEmployees] = useState(initial.employees ?? "");
  const [website, setWebsite] = useState(initial.website ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [ceo, setCeo] = useState(initial.ceo ?? "");
  const [stockTicker, setStockTicker] = useState(initial.stockTicker ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await updateProducerProfile({
        producerId,
        description,
        founded: founded ? Number(founded) : null,
        employees,
        website,
        email,
        phone,
        address,
        ceo,
        stockTicker,
      });
      if (result.ok) {
        setSavedAt(Date.now());
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? { _form: result.formError ?? "Save failed." });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{labels.sectionTitle}</h2>

      <Field id="description" label={labels.description} error={errors.description}>
        <textarea id="description" rows={4} maxLength={2000}
          value={description} onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field id="founded" label={labels.founded} error={errors.founded}>
          <input id="founded" type="number" min={1800} max={new Date().getFullYear() + 1}
            value={founded} onChange={(e) => setFounded(e.target.value)}
            className="w-full px-3 py-2 rounded border border-hairline bg-card" />
        </Field>
        <Field id="employees" label={labels.employees} error={errors.employees}>
          <input id="employees" type="text" maxLength={50}
            value={employees} onChange={(e) => setEmployees(e.target.value)}
            className="w-full px-3 py-2 rounded border border-hairline bg-card" />
        </Field>
      </div>

      <Field id="website" label={labels.website} error={errors.website}>
        <input id="website" type="url" value={website} onChange={(e) => setWebsite(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field id="email" label={labels.email} error={errors.email}>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded border border-hairline bg-card" />
        </Field>
        <Field id="phone" label={labels.phone} error={errors.phone}>
          <input id="phone" type="text" maxLength={50}
            value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 rounded border border-hairline bg-card" />
        </Field>
      </div>

      <Field id="address" label={labels.address} error={errors.address}>
        <input id="address" type="text" maxLength={500}
          value={address} onChange={(e) => setAddress(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field id="ceo" label={labels.ceo} error={errors.ceo}>
          <input id="ceo" type="text" maxLength={100}
            value={ceo} onChange={(e) => setCeo(e.target.value)}
            className="w-full px-3 py-2 rounded border border-hairline bg-card" />
        </Field>
        <Field id="stockTicker" label={labels.stockTicker} error={errors.stockTicker}>
          <input id="stockTicker" type="text" maxLength={20}
            value={stockTicker} onChange={(e) => setStockTicker(e.target.value)}
            className="w-full px-3 py-2 rounded border border-hairline bg-card" />
        </Field>
      </div>

      {errors._form && <p className="text-sm text-down">{errors._form}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="px-4 py-2 rounded-full font-semibold text-sm bg-accent text-accent-foreground disabled:opacity-50">
          {labels.submit}
        </button>
        {savedAt && <span className="text-xs text-up">✓ {labels.saved}</span>}
      </div>
    </form>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-down mt-1">{error}</p>}
    </div>
  );
}
