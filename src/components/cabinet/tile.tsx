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

export const TILE_CLASS =
  "group relative flex aspect-square flex-col justify-between rounded-2xl border bg-card p-3 sm:p-4 transition-colors " +
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
        className="text-[20px] leading-none text-[color:var(--tile-line-strong)]"
      >
        {glyph}
      </span>

      <span className="flex flex-col gap-0.5">
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
        <span className="text-[13px] sm:text-[14px] font-semibold leading-tight text-muted-strong group-hover:text-foreground">
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
      <span aria-hidden className="text-[20px] leading-none text-muted">
        {glyph}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] sm:text-[14px] font-semibold leading-tight text-muted-strong">
          {label}
        </span>
        <span className="text-[11px] leading-tight text-muted">{hint}</span>
      </span>
    </div>
  );
}
