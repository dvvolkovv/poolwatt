// Доска плиток кабинета.
//
// Два столбца держатся до `md`, а не до `sm`: владелец прошёл кабинет с
// телефона 2026-11-28 и сказал, что кнопки стали мелкими. На экране шириной
// 412 точек три столбца дают плитку в 120 точек — это уже меньше пальца с
// запасом, тогда как два дают около 190. Три столбца начинаются с планшета
// (768), четыре — с монитора (1280).
//
// Плитка человека, которая стояла здесь во главе доски, убрана в тот же
// день: учётная запись живёт в шапке (`AccountPill`), а доску занимают
// разделы.

import { accentStyle, type TileAccent } from "@/lib/cabinet/accents";

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
      className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4"
    >
      {children}
    </div>
  );
}
