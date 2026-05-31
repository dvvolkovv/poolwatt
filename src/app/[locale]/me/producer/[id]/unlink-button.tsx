"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { unlinkClaim } from "../actions";

type Props = {
  producerId: string;
  locale: string;
  labels: { button: string; confirm: string };
};

export function UnlinkButton({ producerId, locale, labels }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!confirm(labels.confirm)) return;
    startTransition(async () => {
      const r = await unlinkClaim({ producerId });
      if (r.ok) {
        router.push(`/${locale}/me/producer`);
        router.refresh();
      } else {
        alert(r.formError ?? "Unlink failed.");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-xs text-down border border-down/40 rounded px-3 py-1.5 hover:bg-down/10 disabled:opacity-50"
    >
      {labels.button}
    </button>
  );
}
