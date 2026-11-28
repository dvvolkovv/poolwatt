"use client";

// Единственная кнопка в шапке кабинета. Её цель вычисляется из адреса
// (`parentPath`), а не из истории браузера: по прямой ссылке истории нет, и
// «назад» увело бы человека с сайта.
//
// На доме кабинета кнопки нет вовсе — возвращаться оттуда некуда.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { parentPath } from "@/lib/cabinet/tiles";

export function BackTile({ locale, label }: { locale: string; label: string }) {
  const pathname = usePathname() ?? "";
  const withoutLocale = pathname.replace(new RegExp(`^/${locale}`), "") || "/";
  const parent = parentPath(withoutLocale);
  if (!parent) return null;

  return (
    <Link
      href={`/${locale}${parent}`}
      prefetch={false}
      data-testid="cabinet-back"
      className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-hairline px-4 text-[13px] font-semibold text-muted-strong transition-colors hover:border-[color:var(--tile-line-strong)] hover:text-foreground"
    >
      <span aria-hidden>←</span>
      {label}
    </Link>
  );
}
