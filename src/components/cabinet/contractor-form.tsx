"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ContractorInput } from "@/lib/contractor-schema";
import type { ContractorFormLabels } from "@/lib/contractor-form-labels";
import { createContractor, updateContractor } from "@/app/[locale]/me/contractor/actions";

type Mode = { kind: "create" } | { kind: "edit"; id: string };

const WORK_VALUES = ["DESIGN", "MANUFACTURE", "SUPPLY", "INSTALLATION", "COMMISSIONING", "MAINTENANCE"] as const;
const RENEWABLE_VALUES = ["SOLAR", "WIND", "HYDRO", "BIOMASS", "GEOTHERMAL", "HYBRID"] as const;
const ENTITY_VALUES = ["LEGAL_ENTITY", "SOLE_TRADER", "INDIVIDUAL"] as const;

type Props = {
  mode: Mode;
  locale: string;
  initial?: Partial<ContractorInput>;
  labels: ContractorFormLabels;
};

export function ContractorForm({ mode, locale, initial, labels }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [entityType, setEntityType] = useState<"LEGAL_ENTITY" | "SOLE_TRADER" | "INDIVIDUAL">(
    initial?.entityType ?? "LEGAL_ENTITY",
  );
  const [workCategories, setWorkCategories] = useState<string[]>(
    (initial?.workCategories as string[] | undefined) ?? [],
  );
  const [renewableTypes, setRenewableTypes] = useState<string[]>(
    (initial?.renewableTypes as string[] | undefined) ?? [],
  );

  function toggle(list: string[], v: string, set: (xs: string[]) => void) {
    if (list.includes(v)) set(list.filter((x) => x !== v));
    else set([...list, v]);
  }

  async function onSubmit(formData: FormData) {
    setErrors({});
    setFormError(null);

    const countriesServedRaw = String(formData.get("countriesServed") ?? "");
    const countriesServed = countriesServedRaw
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const foundedYearRaw = String(formData.get("foundedYear") ?? "");
    const foundedYear = foundedYearRaw ? Number(foundedYearRaw) : undefined;

    const input = {
      entityType,
      displayName: String(formData.get("displayName") ?? "").trim(),
      legalName: entityType === "LEGAL_ENTITY"
        ? String(formData.get("legalName") ?? "").trim() || undefined
        : undefined,
      registrationNumber: entityType !== "INDIVIDUAL"
        ? String(formData.get("registrationNumber") ?? "").trim() || undefined
        : undefined,
      country: String(formData.get("country") ?? "").toUpperCase(),
      city: String(formData.get("city") ?? "").trim(),
      foundedYear,
      workCategories: workCategories as ContractorInput["workCategories"],
      renewableTypes: renewableTypes as ContractorInput["renewableTypes"],
      countriesServed,
      bio: String(formData.get("bio") ?? ""),
      websiteUrl: String(formData.get("websiteUrl") ?? "").trim() || undefined,
      logoUrl: String(formData.get("logoUrl") ?? "").trim() || undefined,
      contactEmail: String(formData.get("contactEmail") ?? "").trim(),
      contactPhone: String(formData.get("contactPhone") ?? "").trim(),
    } as ContractorInput;

    startTransition(async () => {
      const result = mode.kind === "create"
        ? await createContractor(input)
        : await updateContractor(mode.id, input);

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        if (result.formError) setFormError(result.formError);
        return;
      }
      const targetId = result.id ?? (mode.kind === "edit" ? mode.id : "");
      router.push(`/${locale}/me/contractor/${targetId}`);
    });
  }

  return (
    <form action={onSubmit} className="space-y-8 max-w-2xl">
      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{labels.section.identity}</legend>

        <div>
          <label className="block text-sm mb-1">{labels.field.entityType.label}</label>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as typeof entityType)}
            className="border border-hairline rounded px-3 py-2 w-full"
          >
            {ENTITY_VALUES.map((v) => (
              <option key={v} value={v}>{labels.field.entityType[v]}</option>
            ))}
          </select>
        </div>

        <input name="displayName" defaultValue={initial?.displayName ?? ""} placeholder={labels.field.displayName.label} className="border border-hairline rounded px-3 py-2 w-full" />
        {errors.displayName && <p className="text-red-600 text-xs">{errors.displayName}</p>}

        {entityType === "LEGAL_ENTITY" && (
          <>
            <input name="legalName" defaultValue={initial?.legalName ?? ""} placeholder={labels.field.legalName.label} className="border border-hairline rounded px-3 py-2 w-full" />
            {errors.legalName && <p className="text-red-600 text-xs">{errors.legalName}</p>}
          </>
        )}

        {entityType !== "INDIVIDUAL" && (
          <>
            <input name="registrationNumber" defaultValue={initial?.registrationNumber ?? ""} placeholder={labels.field.registrationNumber.label} className="border border-hairline rounded px-3 py-2 w-full" />
            {errors.registrationNumber && <p className="text-red-600 text-xs">{errors.registrationNumber}</p>}
          </>
        )}

        <div className="flex gap-2">
          <input name="country" defaultValue={initial?.country ?? ""} placeholder="SK" maxLength={2} className="border border-hairline rounded px-3 py-2 w-20 uppercase" />
          <input name="city" defaultValue={initial?.city ?? ""} placeholder={labels.field.city.label} className="border border-hairline rounded px-3 py-2 flex-1" />
        </div>
        <input name="foundedYear" type="number" min="1900" defaultValue={initial?.foundedYear ?? ""} placeholder={labels.field.foundedYear.label} className="border border-hairline rounded px-3 py-2 w-40" />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{labels.section.work}</legend>

        <div>
          <p className="text-sm mb-2">{labels.field.workCategories.label}</p>
          <div className="grid grid-cols-2 gap-2">
            {WORK_VALUES.map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={workCategories.includes(v)}
                  onChange={() => toggle(workCategories, v, setWorkCategories)}
                />
                {labels.field.workCategories[v]}
              </label>
            ))}
          </div>
          {errors.workCategories && <p className="text-red-600 text-xs mt-1">{errors.workCategories}</p>}
        </div>

        <div>
          <p className="text-sm mb-2">{labels.field.renewableTypes.label}</p>
          <div className="grid grid-cols-2 gap-2">
            {RENEWABLE_VALUES.map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={renewableTypes.includes(v)}
                  onChange={() => toggle(renewableTypes, v, setRenewableTypes)}
                />
                {labels.field.renewableTypes[v]}
              </label>
            ))}
          </div>
          {errors.renewableTypes && <p className="text-red-600 text-xs mt-1">{errors.renewableTypes}</p>}
        </div>

        <input name="countriesServed" defaultValue={(initial?.countriesServed as string[] | undefined)?.join(", ") ?? ""} placeholder={labels.field.countriesServed.label} className="border border-hairline rounded px-3 py-2 w-full uppercase" />
        {errors.countriesServed && <p className="text-red-600 text-xs">{errors.countriesServed}</p>}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{labels.section.contact}</legend>

        <textarea name="bio" defaultValue={initial?.bio ?? ""} rows={6} maxLength={2000} placeholder={labels.field.bio.label} className="border border-hairline rounded px-3 py-2 w-full" />
        {errors.bio && <p className="text-red-600 text-xs">{errors.bio}</p>}

        <input name="websiteUrl" type="url" defaultValue={initial?.websiteUrl ?? ""} placeholder={labels.field.websiteUrl.label} className="border border-hairline rounded px-3 py-2 w-full" />
        <input name="logoUrl" type="url" defaultValue={initial?.logoUrl ?? ""} placeholder={labels.field.logoUrl.label} className="border border-hairline rounded px-3 py-2 w-full" />
        <input name="contactEmail" type="email" defaultValue={initial?.contactEmail ?? ""} placeholder={labels.field.contactEmail.label} className="border border-hairline rounded px-3 py-2 w-full" />
        {errors.contactEmail && <p className="text-red-600 text-xs">{errors.contactEmail}</p>}
        <input name="contactPhone" type="tel" defaultValue={initial?.contactPhone ?? ""} placeholder={labels.field.contactPhone.label} className="border border-hairline rounded px-3 py-2 w-full" />
        {errors.contactPhone && <p className="text-red-600 text-xs">{errors.contactPhone}</p>}
      </fieldset>

      {formError && <p className="text-red-600 text-sm">{formError}</p>}

      <div className="sticky bottom-0 bg-bg pt-4 border-t border-hairline">
        <button
          type="submit"
          disabled={pending}
          className="px-6 py-2 bg-foreground text-bg rounded disabled:opacity-50"
        >
          {mode.kind === "create" ? labels.action.submit : labels.action.save}
        </button>
      </div>
    </form>
  );
}
