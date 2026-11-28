// Цвет контура плиток, который человек выбирает в настройках интерфейса.
//
// Шесть названных цветов, а не свободный выбор. Произвольный цвет ломает
// контраст: подсветка либо исчезает на тёмном фоне, либо выжигает светлый, и
// человек получает настройку, которой нельзя пользоваться.
//
// Цвет приходит на плитку переменной в `style`, а не классом Tailwind:
// Tailwind собирает классы из исходного текста, и имя, склеенное в рантайме,
// в сборку не попадёт вовсе — контур просто остался бы серым.

export const TILE_ACCENTS = [
  "accent",
  "green",
  "blue",
  "amber",
  "violet",
  "neutral",
] as const;

export type TileAccent = (typeof TILE_ACCENTS)[number];

export const DEFAULT_TILE_ACCENT: TileAccent = "accent";

export function isTileAccent(value: unknown): value is TileAccent {
  return (
    typeof value === "string" && TILE_ACCENTS.includes(value as TileAccent)
  );
}

export function parseTileAccent(value: unknown): TileAccent {
  return isTileAccent(value) ? value : DEFAULT_TILE_ACCENT;
}

/** Цвет линии контура. Первые три — переменные темы, чтобы не разойтись с ней. */
export const ACCENT_COLOR: Record<TileAccent, string> = {
  accent: "var(--color-accent)",
  green: "var(--color-green)",
  blue: "var(--color-blue)",
  amber: "#f59e0b",
  violet: "#a78bfa",
  neutral: "var(--color-muted-strong)",
};

/**
 * Переменные, которые плитка кладёт на себя: цвет контура в покое — та же
 * линия, но приглушённая, иначе доска из четырнадцати ярких квадратов
 * перестаёт читаться.
 */
export function accentStyle(accent: TileAccent): React.CSSProperties {
  const color = ACCENT_COLOR[accent];
  return {
    ["--tile-line" as string]: `color-mix(in srgb, ${color} 45%, transparent)`,
    ["--tile-line-strong" as string]: color,
  };
}
