"use client";

// §32.7 — the driver drops a booking. Whether the fee comes back is the
// service's call, not this button's.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dropBooking } from "@/app/[locale]/c/[id]/book/actions";

export function CancelBookingButton({
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
        data-testid="cancel-booking"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await dropBooking(reservationId);
            if (!r.ok) setError(r.formError ?? "Could not cancel.");
            else router.refresh();
          });
        }}
        className="rounded border border-hairline px-3 py-1 text-[13px] hover:border-accent disabled:opacity-50"
      >
        {label}
      </button>
      {error && <span className="ml-2 text-[12px] text-down">{error}</span>}
    </span>
  );
}
