"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptProducerClaim } from "../actions";

type Props = {
  buildRequestId: string;
  claimId: string;
  labels: { button: string; confirm: string };
};

export function AcceptProducerClaimButton({ buildRequestId, claimId, labels }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!confirm(labels.confirm)) return;
    startTransition(async () => {
      const r = await acceptProducerClaim({ buildRequestId, claimId });
      if (r.ok) {
        router.refresh();
      } else {
        alert(r.formError ?? "Accept failed.");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-xs font-semibold border border-accent/40 text-accent rounded px-3 py-1.5 hover:bg-accent/10 disabled:opacity-50"
    >
      {labels.button}
    </button>
  );
}
