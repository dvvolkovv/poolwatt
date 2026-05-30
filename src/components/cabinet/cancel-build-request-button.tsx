"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelBuildRequest } from "@/app/[locale]/me/build-requests/actions";

type Props = { id: string; label: string; locale: string };

export function CancelBuildRequestButton({ id, label, locale }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const r = await cancelBuildRequest(id);
          if (r.ok) router.refresh();
          else alert(r.formError ?? "Failed");
        });
      }}
      className="px-4 py-2 border border-hairline rounded text-sm disabled:opacity-50"
    >
      {label}
    </button>
  );
}
