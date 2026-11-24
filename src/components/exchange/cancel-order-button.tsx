"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawOrder } from "@/app/[locale]/exchange/actions";

export function CancelOrderButton({ orderId, label }: { orderId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await withdrawOrder(orderId);
          router.refresh();
        })
      }
      className="text-[12px] text-muted hover:text-down underline disabled:opacity-50 shrink-0"
    >
      {pending ? "…" : label}
    </button>
  );
}
