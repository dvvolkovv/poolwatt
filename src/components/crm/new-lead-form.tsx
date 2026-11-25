"use client";

// §48 — a place somebody spotted, before it is anything else.

import { useState, useTransition } from "react";
import { createLeadAction } from "@/app/[locale]/me/charger-operator/[id]/pipeline/actions";

export function NewLeadForm({
  operatorId,
  employees,
  labels,
}: {
  operatorId: string;
  employees: { id: string; name: string }[];
  labels: {
    title: string;
    city: string;
    country: string;
    address: string;
    owner: string;
    nobody: string;
    due: string;
    create: string;
  };
}) {
  const [title, setTitle] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [ownerEmployeeId, setOwnerEmployeeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const field = "rounded border border-hairline bg-bg px-2 py-1 text-sm";
  const label = "mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted";

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      data-testid="new-lead-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await createLeadAction({
            operatorId,
            title,
            city: city.trim() || null,
            country: country.trim().toUpperCase() || null,
            addressLine: addressLine.trim() || null,
            ownerEmployeeId: ownerEmployeeId || null,
            dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          });
          if (!r.ok) setError(r.formError);
          else {
            setTitle("");
            setCity("");
            setAddressLine("");
          }
        });
      }}
    >
      <label className="block text-sm">
        <span className={label}>{labels.title}</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label={labels.title}
          className={`${field} w-[220px]`}
        />
      </label>
      <label className="block text-sm">
        <span className={label}>{labels.city}</span>
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          aria-label={labels.city}
          className={`${field} w-32`}
        />
      </label>
      <label className="block text-sm">
        <span className={label}>{labels.country}</span>
        <input
          value={country}
          onChange={(e) => setCountry(e.target.value.slice(0, 2))}
          aria-label={labels.country}
          className={`${field} w-16`}
        />
      </label>
      <label className="block text-sm">
        <span className={label}>{labels.address}</span>
        <input
          value={addressLine}
          onChange={(e) => setAddressLine(e.target.value)}
          aria-label={labels.address}
          className={`${field} w-[200px]`}
        />
      </label>
      <label className="block text-sm">
        <span className={label}>{labels.owner}</span>
        <select
          value={ownerEmployeeId}
          onChange={(e) => setOwnerEmployeeId(e.target.value)}
          aria-label={labels.owner}
          className={field}
        >
          <option value="">{labels.nobody}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className={label}>{labels.due}</span>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          aria-label={labels.due}
          className={field}
        />
      </label>
      <button
        type="submit"
        disabled={pending || title.trim().length < 2}
        data-testid="create-lead"
        className="rounded border border-accent px-3 py-1 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        {labels.create}
      </button>
      {error && (
        <p className="w-full text-[13px] text-down" data-testid="lead-error">
          {error}
        </p>
      )}
    </form>
  );
}
