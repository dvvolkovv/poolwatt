"use client";

import { usePathname } from "next/navigation";

/**
 * The site header and footer are built for a monitor: a 1600-pixel row and a
 * link farm. Under /{locale}/app the phone shell draws its own chrome, so this
 * gate swallows them. Keeping the check here, rather than splitting the route
 * tree into two root layouts, leaves every existing page untouched.
 */
export function ChromeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (/^\/[A-Za-z-]+\/app(\/|$)/.test(pathname ?? "")) return null;
  return <>{children}</>;
}
