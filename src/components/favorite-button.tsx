"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { toggleFavorite } from "@/app/actions/favorites";
import type { FavoriteKind } from "@/lib/favorites";

// One-button-fits-all star for producer rows, charger cards, charger detail
// page. Optimistic toggle, reverts on server failure. Anonymous click is
// caught here and sends the user to /login with callbackUrl pointing back —
// the favorite itself is dropped (we don't queue it); the user can re-click
// after signing in.
//
// `initial` is the server-rendered authoritative state at first paint.
// `signedIn` toggles between two failure modes for an anonymous click.

export function FavoriteButton({
  kind,
  id,
  initial,
  signedIn,
  size = "md",
  label,
}: {
  kind: FavoriteKind;
  id: string;
  initial: boolean;
  signedIn: boolean;
  size?: "sm" | "md";
  label?: { add: string; remove: string };
}) {
  const router = useRouter();
  const locale = useLocale();
  const [active, setActive] = useState(initial);
  const [pending, startTransition] = useTransition();

  const sizeClass = size === "sm" ? "w-7 h-7 text-[14px]" : "w-9 h-9 text-[16px]";
  const aria = active
    ? label?.remove ?? "Remove from favorites"
    : label?.add ?? "Add to favorites";

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!signedIn) {
      // Bounce to login with the current page as callback. We deliberately
      // don't persist the intended favorite — re-click after auth.
      const cb = encodeURIComponent(window.location.pathname + window.location.search);
      router.push(`/${locale}/login?callbackUrl=${cb}`);
      return;
    }
    const desired = !active;
    setActive(desired);  // optimistic
    startTransition(async () => {
      const res = await toggleFavorite(kind, id, desired);
      if (!res.ok) {
        setActive(!desired);  // revert
        // Loud-but-cheap fallback notification — sonner is in deps already
        // but importing it dynamically keeps this server-rendered safe.
        const { toast } = await import("sonner");
        if (res.error === "unauthenticated") {
          const cb = encodeURIComponent(window.location.pathname + window.location.search);
          router.push(`/${locale}/login?callbackUrl=${cb}`);
        } else {
          toast.error("Не удалось сохранить. Попробуйте ещё раз.");
        }
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={active}
      aria-label={aria}
      className={
        sizeClass +
        " inline-flex items-center justify-center rounded-full border transition-all " +
        (active
          ? "border-accent text-accent bg-accent/10 hover:bg-accent/20"
          : "border-hairline text-muted hover:text-foreground hover:border-foreground/40") +
        (pending ? " opacity-60" : "")
      }
    >
      {active ? "★" : "☆"}
    </button>
  );
}
