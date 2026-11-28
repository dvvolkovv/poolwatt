// Доска плиток и её первая плитка — человек. Две колонки на телефоне, три на
// планшете, четыре на мониторе: квадрат в два столбца на телефоне остаётся
// размером с палец, в три — уже нет.

import Link from "next/link";
import { accentStyle, type TileAccent } from "@/lib/cabinet/accents";
import { TILE_CLASS } from "./tile";

export function TileBoard({
  accent,
  children,
}: {
  accent: TileAccent;
  children: React.ReactNode;
}) {
  return (
    <div
      style={accentStyle(accent)}
      data-testid="tile-board"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
    >
      {children}
    </div>
  );
}

/**
 * Плитка пользователя — во главе доски и шире остальных: владелец просил, чтобы
 * во главе кабинета стоял человек, и чтобы нажатие на него вело в настройки.
 * Поэтому она ведёт не на страницу, а на доску `account`.
 */
export function UserTile({
  href,
  username,
  statusLabel,
  caption,
}: {
  href: string;
  username: string;
  statusLabel: string;
  caption: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={`${username} — ${caption}`}
      data-testid="tile-user"
      className={`${TILE_CLASS} col-span-2 aspect-auto min-h-[132px] sm:col-span-3 lg:col-span-4 sm:flex-row sm:items-center sm:justify-start sm:gap-5`}
    >
      <span
        aria-hidden
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[color:var(--tile-line-strong)] text-[20px] font-bold text-bg"
      >
        {username.slice(0, 1).toUpperCase()}
      </span>
      <span className="flex flex-col gap-1">
        {/* Имя человека — заголовок страницы кабинета: другого `h1` здесь
            нет, и во главе стоит он, как и просил владелец. */}
        <h1 className="text-[20px] sm:text-[24px] font-bold leading-none tracking-[-0.02em] text-foreground">
          @{username}
        </h1>
        <span
          data-testid="status-badge"
          className="num text-[11px] uppercase tracking-[0.18em] text-[color:var(--tile-line-strong)]"
        >
          {statusLabel}
        </span>
        <span className="text-[13px] text-muted">{caption}</span>
      </span>
    </Link>
  );
}
