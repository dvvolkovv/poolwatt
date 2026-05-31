"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateChargerOperatorCard } from "../actions";

type Props = {
  operatorId: string;
  initial: {
    displayName: string;
    description: string | null;
    websiteUrl: string | null;
    logoUrl: string | null;
    email: string | null;
    phone: string | null;
  };
  labels: {
    sectionTitle: string;
    displayName: string; description: string; websiteUrl: string; logoUrl: string;
    email: string; phone: string; submit: string; saved: string;
  };
};

export function CardForm({ operatorId, initial, labels }: Props) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [description, setDescription] = useState(initial.description ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(initial.websiteUrl ?? "");
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await updateChargerOperatorCard({
        operatorId, displayName, description, websiteUrl, logoUrl, email, phone,
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

      <Field id="displayName" label={labels.displayName} error={errors.displayName}>
        <input id="displayName" type="text" required maxLength={120}
          value={displayName} onChange={(e) => setDisplayName(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <Field id="description" label={labels.description} error={errors.description}>
        <textarea id="description" rows={4} maxLength={2000}
          value={description} onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <Field id="websiteUrl" label={labels.websiteUrl} error={errors.websiteUrl}>
        <input id="websiteUrl" type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <Field id="logoUrl" label={labels.logoUrl} error={errors.logoUrl}>
        <input id="logoUrl" type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)}
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
