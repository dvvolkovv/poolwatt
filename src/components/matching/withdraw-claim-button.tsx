"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawClaim } from "@/app/[locale]/me/contractor/[id]/requests/actions";

type Props = {
  claimId: string;
  contractorId: string;
  label: string;
};

export function WithdrawClaimButton({ claimId, contractorId, label }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const r = await withdrawClaim({ claimId, contractorId });
          if (r.ok) router.refresh();
          else alert(r.formError ?? "Failed");
        });
      }}
      className="px-3 py-1 border border-hairline rounded text-sm disabled:opacity-50"
    >
      {label}
    </button>
  );
}
