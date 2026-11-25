"use client";

// US-27 — "добавление, удаление, перестановка, сохранение раскладок" (§30).
//
// The editor works on a copy of the layout and only touches the server when
// the producer saves: a panel half-rearranged is nobody's panel.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteDashboardLayout,
  saveDashboardLayout,
  type LayoutActionResult,
} from "@/app/[locale]/me/listing/[companyId]/assets/[assetId]/actions";

type Placement = { key: string; size: string };

export function DashboardEditor({
  initial,
  initialName,
  catalogue,
  widgetNames,
  sizes,
  labels,
}: {
  initial: Placement[];
  /** Null when the built-in panel is on screen and nothing is saved yet. */
  initialName: string | null;
  catalogue: string[];
  widgetNames: Record<string, string>;
  sizes: string[];
  labels: {
    title: string;
    help: string;
    name: string;
    add: string;
    remove: string;
    up: string;
    down: string;
    size: string;
    save: string;
    saved: string;
    delete: string;
    makeDefault: string;
    newName: string;
  };
}) {
  const [layout, setLayout] = useState<Placement[]>(initial);
  const [name, setName] = useState(initialName ?? "");
  const [isDefault, setIsDefault] = useState(true);
  const [result, setResult] = useState<LayoutActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const unused = catalogue.filter((key) => !layout.some((w) => w.key === key));

  function move(index: number, by: number) {
    const next = [...layout];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setLayout(next);
  }

  function save() {
    startTransition(async () => {
      const r = await saveDashboardLayout({ name, widgets: layout, isDefault });
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  function remove(name: string) {
    startTransition(async () => {
      const r = await deleteDashboardLayout({ name });
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <section className="mt-10" data-testid="dashboard-editor">
      <h2 className="mb-1 text-[13px] uppercase tracking-[0.14em] text-muted">{labels.title}</h2>
      <p className="mb-4 max-w-[80ch] text-[12px] text-muted">{labels.help}</p>

      <ol className="mb-4 divide-y divide-hairline text-[13px]" data-testid="layout-widgets">
        {layout.map((w, i) => (
          <li key={w.key} className="flex flex-wrap items-center gap-2 py-2">
            <span className="grow" data-testid={`layout-widget-${w.key}`}>
              <span className="num mr-2 text-muted">{i + 1}</span>
              {widgetNames[w.key] ?? w.key}
            </span>
            <select
              value={w.size}
              onChange={(e) =>
                setLayout(layout.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))
              }
              aria-label={`${labels.size} ${widgetNames[w.key] ?? w.key}`}
              className="rounded border border-hairline bg-transparent px-1.5 py-0.5 text-[12px]"
            >
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => move(i, -1)}
              aria-label={`${labels.up} ${widgetNames[w.key] ?? w.key}`}
              data-testid={`layout-up-${w.key}`}
              className="rounded border border-hairline px-2 py-0.5 text-[12px] hover:border-accent"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              aria-label={`${labels.down} ${widgetNames[w.key] ?? w.key}`}
              data-testid={`layout-down-${w.key}`}
              className="rounded border border-hairline px-2 py-0.5 text-[12px] hover:border-accent"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => setLayout(layout.filter((_, j) => j !== i))}
              aria-label={`${labels.remove} ${widgetNames[w.key] ?? w.key}`}
              data-testid={`layout-remove-${w.key}`}
              className="rounded border border-hairline px-2 py-0.5 text-[12px] hover:border-down"
            >
              ×
            </button>
          </li>
        ))}
      </ol>

      {unused.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted">{labels.add}</span>
          {unused.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setLayout([...layout, { key, size: "S" }])}
              data-testid={`layout-add-${key}`}
              className="rounded border border-hairline px-2 py-1 text-[12px] hover:border-accent"
            >
              + {widgetNames[key] ?? key}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={labels.newName}
          aria-label={labels.name}
          data-testid="layout-name"
          className="rounded border border-hairline bg-transparent px-2 py-1.5 text-sm"
        />
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          {labels.makeDefault}
        </label>
        <button
          type="button"
          onClick={save}
          disabled={pending || name.trim().length === 0 || layout.length === 0}
          data-testid="layout-save"
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {pending ? "…" : labels.save}
        </button>
        {initialName && (
          <button
            type="button"
            onClick={() => remove(initialName)}
            disabled={pending}
            data-testid="layout-delete"
            className="rounded border border-hairline px-3 py-1.5 text-sm hover:border-down disabled:opacity-50"
          >
            {labels.delete}
          </button>
        )}
        {result && !result.ok && (
          <span className="text-[12px] text-down" data-testid="layout-error">
            {result.formError}
          </span>
        )}
        {result?.ok && (
          <span className="text-[12px] text-up" data-testid="layout-saved">
            {labels.saved}
          </span>
        )}
      </div>
    </section>
  );
}
