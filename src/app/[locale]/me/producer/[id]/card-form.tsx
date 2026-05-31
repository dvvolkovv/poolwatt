"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProducerCard } from "../actions";

type Props = {
  producerId: string;
  initial: {
    displayName: string;
    bio: string | null;
    logoUrl: string | null;
    websiteUrl: string | null;
    twitterUrl: string | null;
  };
  labels: {
    sectionTitle: string;
    displayName: string;
    bio: string;
    logoUrl: string;
    websiteUrl: string;
    twitterUrl: string;
    submit: string;
    saved: string;
  };
};

export function CardForm({ producerId, initial, labels }: Props) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(initial.websiteUrl ?? "");
  const [twitterUrl, setTwitterUrl] = useState(initial.twitterUrl ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await updateProducerCard({
        producerId, displayName, bio, logoUrl, websiteUrl, twitterUrl,
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
        <input
          id="displayName" type="text" required maxLength={120}
          value={displayName} onChange={(e) => setDisplayName(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card"
        />
      </Field>

      <Field id="bio" label={labels.bio} error={errors.bio}>
        <textarea
          id="bio" rows={3} maxLength={1000}
          value={bio} onChange={(e) => setBio(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card"
        />
      </Field>

      <Field id="logoUrl" label={labels.logoUrl} error={errors.logoUrl}>
        <input id="logoUrl" type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <Field id="websiteUrl" label={labels.websiteUrl} error={errors.websiteUrl}>
        <input id="websiteUrl" type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <Field id="twitterUrl" label={labels.twitterUrl} error={errors.twitterUrl}>
        <input id="twitterUrl" type="url" value={twitterUrl} onChange={(e) => setTwitterUrl(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      {errors._form && <p className="text-sm text-down">{errors._form}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit" disabled={pending}
          className="px-4 py-2 rounded-full font-semibold text-sm bg-accent text-accent-foreground disabled:opacity-50"
        >
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
