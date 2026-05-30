"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawContractor } from "@/app/[locale]/me/contractor/actions";

type Props = { id: string; label: string; confirmText: string; locale: string };

export function WithdrawContractorButton({ id, label, confirmText, locale }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(confirmText)) return;
        startTransition(async () => {
          const r = await withdrawContractor(id);
          if (r.ok) router.push(`/${locale}/me/contractor`);
          else alert(r.formError ?? "Failed");
        });
      }}
      className="px-4 py-2 border border-hairline rounded text-sm disabled:opacity-50"
    >
      {label}
    </button>
  );
}
