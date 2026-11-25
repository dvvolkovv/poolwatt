"use client";

// US-31 — the button the reminder points at. How long the window moves and
// what it costs is the owner's policy, not this button's business.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extendBooking } from "@/app/[locale]/c/[id]/book/actions";

export function ExtendBookingButton({
  reservationId,
  label,
}: {
  reservationId: string;
  label: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span>
      <button
        type="button"
        data-testid="extend-booking"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await extendBooking(reservationId);
            if (!r.ok) setError(r.formError ?? "Could not extend.");
            else router.refresh();
          });
        }}
        className="rounded border border-accent px-3 py-1 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        {label}
      </button>
      {error && (
        <span className="ml-2 text-[12px] text-down" data-testid="extend-error">
          {error}
        </span>
      )}
    </span>
  );
}
