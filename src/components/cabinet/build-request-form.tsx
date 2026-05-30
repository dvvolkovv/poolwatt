"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { BuildRequestInput } from "@/lib/build-request-schema";
import type { BuildRequestFormLabels } from "@/lib/build-request-form-labels";
import { createBuildRequest, updateBuildRequest } from "@/app/[locale]/me/build-requests/actions";

type Mode = { kind: "create" } | { kind: "edit"; id: string };

type Props = {
  mode: Mode;
  locale: string;
  initial?: Partial<BuildRequestInput>;
  hasPhone: boolean;
  hasName: boolean;
  labels: BuildRequestFormLabels;
};

export function BuildRequestForm({ mode, locale, initial, hasPhone, hasName, labels }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [source, setSource] = useState<"SOLAR" | "WIND" | "HYBRID">(initial?.source ?? "SOLAR");
  const [wantPowerbank, setWantPowerbank] = useState(initial?.wantPowerbank ?? false);
  const [wantEvCharger, setWantEvCharger] = useState(initial?.wantEvCharger ?? false);

  const canSubmit = hasPhone && hasName;

  async function onSubmit(formData: FormData) {
    setErrors({});
    setFormError(null);

    const input: BuildRequestInput = {
      source,
      peakKw: Number(formData.get("peakKw")),
      wantPowerbank,
      powerbankKwh: wantPowerbank ? Number(formData.get("powerbankKwh")) : undefined,
      wantEvCharger,
      evChargerPorts: wantEvCharger ? Number(formData.get("evChargerPorts")) : undefined,
      evPublicForSale: wantEvCharger && formData.get("evPublicForSale") === "on",
      country: String(formData.get("country") ?? "").toUpperCase(),
      city: String(formData.get("city") ?? ""),
      addressLine: String(formData.get("addressLine") ?? ""),
      siteType: formData.get("siteType") as BuildRequestInput["siteType"],
      availableAreaM2: formData.get("availableAreaM2")
        ? Number(formData.get("availableAreaM2"))
        : undefined,
      roofOrientation: source === "WIND"
        ? undefined
        : (formData.get("roofOrientation") as BuildRequestInput["roofOrientation"]),
      budget: formData.get("budget") as BuildRequestInput["budget"],
      timeline: formData.get("timeline") as BuildRequestInput["timeline"],
      notes: String(formData.get("notes") ?? "") || undefined,
    };

    startTransition(async () => {
      const result = mode.kind === "create"
        ? await createBuildRequest(input)
        : await updateBuildRequest(mode.id, input);

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        if (result.formError) setFormError(result.formError);
        return;
      }
      const targetId = result.id ?? (mode.kind === "edit" ? mode.id : "");
      router.push(`/${locale}/me/build-requests/${targetId}`);
    });
  }

  return (
    <form action={onSubmit} className="space-y-8 max-w-2xl">
      {!canSubmit && (
        <div className="bg-yellow-50 text-yellow-900 p-3 rounded text-sm">
          <p>
            {!hasName && !hasPhone
              ? labels.error.contactRequired
              : !hasName
              ? labels.error.nameRequired
              : labels.error.phoneRequired}
          </p>
          <Link
            href={labels.settingsHref}
            className="inline-block mt-2 underline font-medium"
          >
            {labels.settingsLinkText}
          </Link>
        </div>
      )}

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{labels.section.what}</legend>

        <div>
          <label className="block text-sm mb-1">{labels.field.source.label}</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as typeof source)}
            className="border border-hairline rounded px-3 py-2"
          >
            <option value="SOLAR">{labels.field.source.SOLAR}</option>
            <option value="WIND">{labels.field.source.WIND}</option>
            <option value="HYBRID">{labels.field.source.HYBRID}</option>
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">{labels.field.peakKw.label}</label>
          <input
            name="peakKw" type="number" step="0.1" min="0.5" max="500"
            defaultValue={initial?.peakKw ?? 5}
            className="border border-hairline rounded px-3 py-2 w-40"
          />
          {errors.peakKw && <p className="text-red-600 text-xs mt-1">{errors.peakKw}</p>}
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={wantPowerbank}
            onChange={(e) => setWantPowerbank(e.target.checked)}
          />
          {labels.field.wantPowerbank.label}
        </label>
        {wantPowerbank && (
          <input
            name="powerbankKwh" type="number" min="1" max="500" step="0.5"
            defaultValue={initial?.powerbankKwh ?? 10}
            placeholder={labels.field.powerbankKwh.label}
            className="border border-hairline rounded px-3 py-2 w-40"
          />
        )}

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={wantEvCharger}
            onChange={(e) => setWantEvCharger(e.target.checked)}
          />
          {labels.field.wantEvCharger.label}
        </label>
        {wantEvCharger && (
          <>
            <input
              name="evChargerPorts" type="number" min="1" max="10" step="1"
              defaultValue={initial?.evChargerPorts ?? 1}
              placeholder={labels.field.evChargerPorts.label}
              className="border border-hairline rounded px-3 py-2 w-40"
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox" name="evPublicForSale"
                defaultChecked={initial?.evPublicForSale ?? false}
              />
              {labels.field.evPublicForSale.label}
            </label>
          </>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{labels.section.where}</legend>
        <input name="country" defaultValue={initial?.country ?? ""} placeholder="SK" maxLength={2} className="border border-hairline rounded px-3 py-2 w-20 uppercase" />
        <input name="city" defaultValue={initial?.city ?? ""} placeholder={labels.field.city.label} className="border border-hairline rounded px-3 py-2 w-full" />
        <input name="addressLine" defaultValue={initial?.addressLine ?? ""} placeholder={labels.field.addressLine.label} className="border border-hairline rounded px-3 py-2 w-full" />
        <select name="siteType" defaultValue={initial?.siteType ?? "PRIVATE_HOUSE"} className="border border-hairline rounded px-3 py-2">
          {(["PRIVATE_HOUSE", "APARTMENT_ROOF", "LAND_PLOT", "COMMERCIAL"] as const).map((v) => (
            <option key={v} value={v}>{labels.field.siteType[v]}</option>
          ))}
        </select>
        <input name="availableAreaM2" type="number" min="0" defaultValue={initial?.availableAreaM2 ?? ""} placeholder={labels.field.availableAreaM2.label} className="border border-hairline rounded px-3 py-2 w-40" />
        {source !== "WIND" && (
          <select name="roofOrientation" defaultValue={initial?.roofOrientation ?? "S"} className="border border-hairline rounded px-3 py-2">
            {(["S", "SE", "SW", "E", "W", "UNKNOWN"] as const).map((v) => (
              <option key={v} value={v}>{labels.field.roofOrientation[v]}</option>
            ))}
          </select>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{labels.section.money}</legend>
        <select name="budget" defaultValue={initial?.budget ?? "AWAITING_QUOTE"} className="border border-hairline rounded px-3 py-2">
          {(["UNDER_5K","FROM_5K_TO_15K","FROM_15K_TO_30K","FROM_30K_TO_60K","OVER_60K","AWAITING_QUOTE"] as const).map((v) => (
            <option key={v} value={v}>{labels.field.budget[v]}</option>
          ))}
        </select>
        <select name="timeline" defaultValue={initial?.timeline ?? "EXPLORING"} className="border border-hairline rounded px-3 py-2">
          {(["URGENT_1_3M","WITHIN_YEAR","EXPLORING"] as const).map((v) => (
            <option key={v} value={v}>{labels.field.timeline[v]}</option>
          ))}
        </select>
        <textarea name="notes" defaultValue={initial?.notes ?? ""} maxLength={1000} rows={4} placeholder={labels.field.notes.label} className="border border-hairline rounded px-3 py-2 w-full" />
      </fieldset>

      {formError && <p className="text-red-600 text-sm">{formError}</p>}

      <div className="sticky bottom-0 bg-bg pt-4 border-t border-hairline">
        <button
          type="submit"
          disabled={pending || !canSubmit}
          className="px-6 py-2 bg-foreground text-bg rounded disabled:opacity-50"
        >
          {mode.kind === "create" ? labels.action.submit : labels.action.save}
        </button>
      </div>
    </form>
  );
}
