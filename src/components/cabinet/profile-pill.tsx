"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

export function ProfilePill({
  username,
  labels,
  locale,
}: {
  username: string;
  labels: { cabinet: string; settings: string; signOut: string };
  locale: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 text-xs px-4 py-1.5 rounded-full font-semibold uppercase tracking-wider border border-hairline text-foreground hover:border-accent/60 transition-all"
        aria-expanded={open}
      >
        <span className="w-5 h-5 rounded-full bg-accent text-accent-foreground inline-flex items-center justify-center text-[10px] font-bold">
          {username.slice(0, 1).toUpperCase()}
        </span>
        <span>@{username}</span>
        <span aria-hidden className="text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-card border border-hairline rounded-lg shadow-lg overflow-hidden text-sm">
          <Link
            href={`/${locale}/me/favorites`}
            prefetch={false}
            className="block px-4 py-2.5 hover:bg-bg-tint transition-colors"
            onClick={() => setOpen(false)}
          >
            {labels.cabinet}
          </Link>
          <Link
            href={`/${locale}/me/settings`}
            prefetch={false}
            className="block px-4 py-2.5 hover:bg-bg-tint transition-colors"
            onClick={() => setOpen(false)}
          >
            {labels.settings}
          </Link>
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: `/${locale}` })}
            className="block w-full text-left px-4 py-2.5 hover:bg-bg-tint transition-colors text-down border-t border-hairline"
          >
            {labels.signOut}
          </button>
        </div>
      )}
    </div>
  );
}
