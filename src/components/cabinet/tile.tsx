// Квадратная плитка кабинета: закруглённые углы, контур цветом, который
// выбрал человек, название и — если за ней есть настоящее число — одна строка
// значения. Вся плитка это одна ссылка, то есть палец попадает в любую точку.
//
// Цвет приходит переменной в `style` (см. `accentStyle`): Tailwind собирает
// классы из исходного текста, и класс, склеенный в рантайме, в сборку не
// попал бы.

import Link from "next/link";
import type { TileValue } from "@/lib/cabinet/context";

export interface TileProps {
  href: string;
  label: string;
  glyph: string;
  value?: TileValue;
  /** Подпись значения: «кВт·ч», «открыто», «паёв». */
  unit?: string;
  testId?: string;
}

// Содержимое плитки стоит по центру — и по вертикали, и по горизонтали.
// Владелец попросил об этом 2026-11-28: в два столбца на телефоне плитка
// широкая, и знак в одном углу со словом в другом смотрелись разболтанно.
// `min-w-0` обязателен: без него длинное слово в сетке `grid` растягивает
// колонку, и страница начинает ездить вправо-влево.
export const TILE_CLASS =
  "group relative flex aspect-square min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border bg-card p-3 text-center sm:p-4 transition-colors " +
  "border-[color:var(--tile-line)] hover:border-[color:var(--tile-line-strong)] " +
  "focus-visible:border-[color:var(--tile-line-strong)]";

export function Tile({ href, label, glyph, value, unit, testId }: TileProps) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={label}
      data-testid={testId}
      data-tile
      className={TILE_CLASS}
    >
      <span
        aria-hidden
        className="text-[26px] leading-none text-[color:var(--tile-line-strong)] sm:text-[30px]"
      >
        {glyph}
      </span>

      <span className="flex min-w-0 flex-col items-center gap-0.5">
        {value && (
          <span className="num text-[22px] sm:text-[26px] font-bold leading-none tracking-[-0.02em] text-foreground">
            {value.primary}
            {unit && (
              <span className="ml-1 text-[11px] font-medium text-muted">
                {unit}
              </span>
            )}
          </span>
        )}
        {value?.secondary && (
          <span className="num text-[12px] text-muted">{value.secondary}</span>
        )}
        <span className="text-[13px] sm:text-[15px] font-semibold leading-tight text-muted-strong group-hover:text-foreground">
          {label}
        </span>
      </span>
    </Link>
  );
}

/**
 * Плитка, которая ждёт внешнюю сторону. Выглядит как остальные, но нажать её
 * нельзя, и под названием сказано, чего именно она ждёт: §22.2 называет
 * «Перевести» и «Пополнить» быстрыми кнопками, и честнее подписать «ждёт
 * банка», чем убрать их и сделать вид, что раздела нет.
 */
export function ClosedTile({
  label,
  glyph,
  hint,
  testId,
}: {
  label: string;
  glyph: string;
  hint: string;
  testId?: string;
}) {
  return (
    <div
      aria-disabled="true"
      title={hint}
      data-testid={testId}
      data-tile
      className={`${TILE_CLASS} cursor-not-allowed opacity-55`}
    >
      <span
        aria-hidden
        className="text-[26px] leading-none text-muted sm:text-[30px]"
      >
        {glyph}
      </span>
      <span className="flex min-w-0 flex-col items-center gap-0.5">
        <span className="text-[13px] sm:text-[15px] font-semibold leading-tight text-muted-strong">
          {label}
        </span>
        <span className="text-[11px] leading-tight text-muted">{hint}</span>
      </span>
    </div>
  );
}
