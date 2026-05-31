"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawProducerClaim } from "./actions";

type Props = {
  producerId: string;
  claimId: string;
  labels: { button: string; confirm: string };
};

export function WithdrawButton({ producerId, claimId, labels }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!confirm(labels.confirm)) return;
    startTransition(async () => {
      const r = await withdrawProducerClaim({ claimId, producerId });
      if (r.ok) {
        router.refresh();
      } else {
        alert(r.formError ?? "Withdraw failed.");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-xs text-down border border-down/40 rounded px-2 py-1 hover:bg-down/10 disabled:opacity-50"
    >
      {labels.button}
    </button>
  );
}
