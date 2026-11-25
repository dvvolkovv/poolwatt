"use client";

import { useActionState } from "react";
import { updateReceiptDeliveryAction } from "@/app/[locale]/me/settings/actions";

type Props = {
  receiptEmail: boolean;
  receiptPush: boolean;
  pushAvailable: boolean;
  labels: {
    title: string;
    hint: string;
    email: string;
    push: string;
    pushClosed: string;
    submit: string;
    success: string;
  };
};

/** §46 "Клиент выбирает способ в настройках". */
export function ReceiptDeliverySection({
  receiptEmail,
  receiptPush,
  pushAvailable,
  labels,
}: Props) {
  const [state, action, pending] = useActionState(updateReceiptDeliveryAction, {});

  return (
    <section className="border-t border-hairline pt-8">
      <h2 className="text-[18px] font-semibold mb-1">{labels.title}</h2>
      <p className="text-[13px] text-muted mb-4">{labels.hint}</p>
      <form action={action} className="max-w-md space-y-3">
        <label className="flex items-center gap-3 text-[14px]">
          <input
            type="checkbox"
            name="receiptEmail"
            defaultChecked={receiptEmail}
            className="h-4 w-4 accent-accent"
          />
          {labels.email}
        </label>
        <label className="flex items-center gap-3 text-[14px]">
          <input
            type="checkbox"
            name="receiptPush"
            defaultChecked={receiptPush}
            className="h-4 w-4 accent-accent"
          />
          {labels.push}
          {!pushAvailable && (
            <span className="text-[12px] text-muted">({labels.pushClosed})</span>
          )}
        </label>
        <div>
          <button
            type="submit"
            disabled={pending}
            className="border border-hairline hover:border-accent rounded-md px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.12em] disabled:opacity-60 transition-colors"
          >
            {labels.submit}
          </button>
          {state.ok && <p className="mt-2 text-xs text-up">{labels.success}</p>}
        </div>
      </form>
    </section>
  );
}
