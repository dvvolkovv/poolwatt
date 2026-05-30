"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptClaim } from "@/app/[locale]/me/build-requests/actions";

type Props = {
  claimId: string;
  label: string;
  confirmText: string;
};

export function AcceptClaimButton({ claimId, label, confirmText }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(confirmText)) return;
        startTransition(async () => {
          const r = await acceptClaim(claimId);
          if (r.ok) router.refresh();
          else alert(r.formError ?? "Failed");
        });
      }}
      className="px-4 py-2 bg-foreground text-bg rounded text-sm disabled:opacity-50"
    >
      {label}
    </button>
  );
}
