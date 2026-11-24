"use client";

import { useFormStatus } from "react-dom";

// Colours, radius and height are Taler ID's: https://talerid.io/brand/
export function TalerIdSubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full h-11 px-4 inline-flex items-center justify-center rounded-[8px] border border-[#167EF2] bg-[#167EF2] text-white text-[14px] font-semibold transition-colors hover:bg-[#1570D6] hover:border-[#1570D6] disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
