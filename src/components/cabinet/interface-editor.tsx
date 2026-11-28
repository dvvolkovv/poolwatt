"use client";

// Настройки интерфейса: цвет контура плиток и их порядок.
//
// Перетаскивание сделано на Pointer Events, а не на HTML5 drag-and-drop:
// последний на телефоне не работает вовсе, а кабинет владелец смотрит с
// телефона. Рядом с перетаскиванием стоят кнопки «выше/ниже» — и это не
// дубль: перетаскивание недоступно с клавиатуры, а порядок своих разделов
// должен настраиваться и без мыши.

import { useRef, useState } from "react";
import {
  ACCENT_COLOR,
  TILE_ACCENTS,
  type TileAccent,
} from "@/lib/cabinet/accents";

export interface EditorTile {
  key: string;
  label: string;
  glyph: string;
}

export function InterfaceEditor({
  tiles,
  accent: savedAccent,
  labels,
  accentNames,
  action,
  resetAction,
}: {
  tiles: EditorTile[];
  accent: TileAccent;
  labels: {
    accentTitle: string;
    accentHint: string;
    orderTitle: string;
    orderHint: string;
    up: string;
    down: string;
    save: string;
    reset: string;
  };
  accentNames: Record<TileAccent, string>;
  action: (formData: FormData) => void;
  resetAction: () => void;
}) {
  const [accent, setAccent] = useState<TileAccent>(savedAccent);
  const [order, setOrder] = useState<EditorTile[]>(tiles);
  const dragFrom = useRef<number | null>(null);

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((current) => {
      const next = current.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  const lineStyle = {
    ["--tile-line" as string]: `color-mix(in srgb, ${ACCENT_COLOR[accent]} 45%, transparent)`,
    ["--tile-line-strong" as string]: ACCENT_COLOR[accent],
  };

  return (
    <form action={action} style={lineStyle} className="space-y-10">
      <input type="hidden" name="accent" value={accent} />
      <input
        type="hidden"
        name="order"
        value={order.map((t) => t.key).join(",")}
      />

      <section>
        <h2 className="text-[18px] font-bold tracking-[-0.02em]">
          {labels.accentTitle}
        </h2>
        <p className="mt-1 text-[13px] text-muted">{labels.accentHint}</p>
        <div
          role="radiogroup"
          aria-label={labels.accentTitle}
          className="mt-4 flex flex-wrap gap-3"
        >
          {TILE_ACCENTS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={accent === option}
              onClick={() => setAccent(option)}
              data-testid={`accent-${option}`}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-[13px] font-semibold transition-colors ${
                accent === option
                  ? "border-[color:var(--tile-line-strong)] text-foreground"
                  : "border-hairline text-muted hover:text-foreground"
              }`}
            >
              <span
                aria-hidden
                className="h-4 w-4 rounded-full border-2"
                style={{ borderColor: ACCENT_COLOR[option] }}
              />
              {accentNames[option]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[18px] font-bold tracking-[-0.02em]">
          {labels.orderTitle}
        </h2>
        <p className="mt-1 text-[13px] text-muted">{labels.orderHint}</p>

        <ul className="mt-4 space-y-2" data-testid="tile-order">
          {order.map((tile, index) => (
            <li
              key={tile.key}
              draggable
              data-testid={`order-row-${tile.key}`}
              onPointerDown={() => {
                dragFrom.current = index;
              }}
              onPointerEnter={() => {
                if (dragFrom.current === null || dragFrom.current === index)
                  return;
                move(dragFrom.current, index);
                dragFrom.current = index;
              }}
              onPointerUp={() => {
                dragFrom.current = null;
              }}
              onPointerCancel={() => {
                dragFrom.current = null;
              }}
              className="flex touch-none items-center gap-3 rounded-xl border border-[color:var(--tile-line)] bg-card px-3 py-2"
            >
              <span aria-hidden className="cursor-grab text-[16px] text-muted">
                ⠿
              </span>
              <span
                aria-hidden
                className="text-[18px] text-[color:var(--tile-line-strong)]"
              >
                {tile.glyph}
              </span>
              <span className="flex-1 text-[14px] font-semibold">
                {tile.label}
              </span>
              <span className="num text-[11px] text-muted">{index + 1}</span>
              <button
                type="button"
                onClick={() => move(index, index - 1)}
                disabled={index === 0}
                aria-label={`${labels.up}: ${tile.label}`}
                data-testid={`order-up-${tile.key}`}
                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-hairline text-[13px] hover:border-[color:var(--tile-line-strong)] disabled:opacity-40"
              >
                <span aria-hidden>↑</span>
              </button>
              <button
                type="button"
                onClick={() => move(index, index + 1)}
                disabled={index === order.length - 1}
                aria-label={`${labels.down}: ${tile.label}`}
                data-testid={`order-down-${tile.key}`}
                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-hairline text-[13px] hover:border-[color:var(--tile-line-strong)] disabled:opacity-40"
              >
                <span aria-hidden>↓</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          data-testid="interface-save"
          className="inline-flex min-h-[44px] items-center rounded-full bg-accent px-6 text-[13px] font-semibold uppercase tracking-[0.16em] text-accent-foreground hover:brightness-110"
        >
          {labels.save}
        </button>
        <button
          type="submit"
          formAction={resetAction}
          data-testid="interface-reset"
          className="inline-flex min-h-[44px] items-center rounded-full border border-hairline px-6 text-[13px] font-semibold uppercase tracking-[0.16em] text-muted hover:text-foreground"
        >
          {labels.reset}
        </button>
      </div>
    </form>
  );
}
