// §30 «Виджеты (настраиваемая панель)» на телефоне — одна колонка.
//
// Числа берутся из общего `figureValues`, поэтому с пультом на мониторе они
// разойтись не могут. Разметка своя: на мониторе сетка в три колонки, здесь
// плитки одна под другой, крупная цифра первой.
//
// Раскладка применяется, но не редактируется: перетаскивать плитки нужна
// мышь, а делать это на четырёх дюймах значит делать плохо. Выбор из
// сохранённых раскладок есть, и экран говорит, где их собирают.

import type { FigureValue } from "@/lib/dashboard/widget-values";
import type { WidgetKey, WidgetPlacement } from "@/lib/dashboard/widgets";

export function StationPanel({
  layout,
  figures,
  names,
  complex: complexNodes,
}: {
  layout: WidgetPlacement[];
  figures: Partial<Record<WidgetKey, FigureValue>>;
  names: Record<string, string>;
  /** График, прогноз, аварии, железо — у них своя разметка. */
  complex: Partial<Record<WidgetKey, React.ReactNode>>;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {layout.map(({ key, size }) => {
        const node = complexNodes[key];
        if (node) {
          return (
            <div key={key} className="col-span-2">
              {node}
            </div>
          );
        }
        const value = figures[key];
        if (!value) return null;
        // Крупная плитка занимает ряд целиком: на телефоне «L» — это ширина,
        // а не площадь.
        const wide = size === "L" || key === "nowKw";
        return (
          <div
            key={key}
            className={`rounded-lg border border-hairline bg-card px-3 py-3 ${
              wide ? "col-span-2" : ""
            }`}
          >
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
              {names[key] ?? key}
            </div>
            <div className={`num mt-1 ${wide ? "text-[26px] font-semibold" : "text-[17px]"}`}>
              <span data-testid={`panel-${key}`}>{value.value}</span>
              <span className="ml-1 text-[11px] text-muted">{value.unit}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
