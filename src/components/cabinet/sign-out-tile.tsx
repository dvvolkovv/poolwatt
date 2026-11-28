"use client";

// Единственная плитка-действие: выход. Выглядит ровно как остальные плитки,
// потому что владелец просил, чтобы в кабинете всё было квадратами, а не
// ссылками, — но это кнопка, и роль у неё кнопочная.

import { signOut } from "next-auth/react";
import { TILE_CLASS } from "./tile";

export function SignOutTile({
  locale,
  label,
  glyph,
}: {
  locale: string;
  label: string;
  glyph: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: `/${locale}` })}
      aria-label={label}
      data-testid="tile-signOut"
      data-tile
      className={TILE_CLASS}
    >
      <span
        aria-hidden
        className="text-[26px] leading-none text-down sm:text-[30px]"
      >
        {glyph}
      </span>
      <span className="text-[13px] sm:text-[15px] font-semibold leading-tight text-down">
        {label}
      </span>
    </button>
  );
}
