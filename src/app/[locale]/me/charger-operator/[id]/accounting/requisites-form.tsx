"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveOperatorAccounting } from "./actions";

type Values = {
  legalName: string;
  regNumber: string;
  vatNumber: string;
  addressLine: string;
  city: string;
  country: string;
  vatRatePct: string;
  taxNote: string;
  datevConsultantNo: string;
  datevClientNo: string;
  revenueAccount: string;
  counterAccount: string;
  fiscalYearStart: string;
  bmdClientNo: string;
};

type Props = {
  operatorId: string;
  initial: Values;
  labels: Record<string, string>;
};

const TEXT_FIELDS: (keyof Values)[] = [
  "legalName",
  "regNumber",
  "vatNumber",
  "addressLine",
  "city",
  "country",
];
const ACCOUNT_FIELDS: (keyof Values)[] = [
  "datevConsultantNo",
  "datevClientNo",
  "revenueAccount",
  "counterAccount",
  "bmdClientNo",
];

export function RequisitesForm({ operatorId, initial, labels }: Props) {
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const nullable = (v: string) => (v.trim() === "" ? null : v.trim());

  function submit() {
    setErrors({});
    setSaved(false);
    startTransition(async () => {
      const rate = values.vatRatePct.replace(",", ".").trim();
      const month = values.fiscalYearStart.trim();
      const r = await saveOperatorAccounting({
        operatorId,
        legalName: nullable(values.legalName),
        regNumber: nullable(values.regNumber),
        vatNumber: nullable(values.vatNumber),
        addressLine: nullable(values.addressLine),
        city: nullable(values.city),
        country: nullable(values.country),
        vatRatePct: rate === "" ? null : Number(rate),
        taxNote: nullable(values.taxNote),
        datevConsultantNo: nullable(values.datevConsultantNo),
        datevClientNo: nullable(values.datevClientNo),
        revenueAccount: nullable(values.revenueAccount),
        counterAccount: nullable(values.counterAccount),
        fiscalYearStart: month === "" ? null : Number(month),
        bmdClientNo: nullable(values.bmdClientNo),
      });
      if (r.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setErrors(r.fieldErrors ?? { _form: r.formError ?? "Save failed." });
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-5"
      data-testid="requisites-form"
    >
      <div>
        <h2 className="text-[18px] font-semibold">{labels.requisitesTitle}</h2>
        <p className="mt-1 text-[13px] text-muted">{labels.requisitesHelp}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {TEXT_FIELDS.map((field) => (
          <label key={field} className="block text-[13px]">
            <span className="text-muted">{labels[field]}</span>
            <input
              name={field}
              value={values[field]}
              onChange={set(field)}
              className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {errors[field] && <span className="text-xs text-down">{errors[field]}</span>}
          </label>
        ))}
        <label className="block text-[13px]">
          <span className="text-muted">{labels.vatRatePct}</span>
          <input
            name="vatRatePct"
            value={values.vatRatePct}
            onChange={set("vatRatePct")}
            inputMode="decimal"
            placeholder={labels.vatRatePlaceholder}
            className="num mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {errors.vatRatePct && <span className="text-xs text-down">{errors.vatRatePct}</span>}
        </label>
      </div>

      <label className="block text-[13px]">
        <span className="text-muted">{labels.taxNote}</span>
        <textarea
          name="taxNote"
          value={values.taxNote}
          onChange={set("taxNote")}
          rows={2}
          className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>

      <div className="border-t border-hairline pt-5">
        <h2 className="text-[18px] font-semibold">{labels.accountsTitle}</h2>
        <p className="mt-1 text-[13px] text-muted">{labels.accountsHelp}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {ACCOUNT_FIELDS.map((field) => (
            <label key={field} className="block text-[13px]">
              <span className="text-muted">{labels[field]}</span>
              <input
                name={field}
                value={values[field]}
                onChange={set(field)}
                className="num mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {errors[field] && <span className="text-xs text-down">{errors[field]}</span>}
            </label>
          ))}
          <label className="block text-[13px]">
            <span className="text-muted">{labels.fiscalYearStart}</span>
            <input
              name="fiscalYearStart"
              value={values.fiscalYearStart}
              onChange={set("fiscalYearStart")}
              inputMode="numeric"
              className="num mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {errors.fiscalYearStart && (
              <span className="text-xs text-down">{errors.fiscalYearStart}</span>
            )}
          </label>
        </div>
      </div>

      {errors._form && <p className="text-xs text-down">{errors._form}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-hairline px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.12em] hover:border-accent disabled:opacity-60"
        >
          {labels.save}
        </button>
        {saved && <span className="text-xs text-up">{labels.saved}</span>}
      </div>
    </form>
  );
}
