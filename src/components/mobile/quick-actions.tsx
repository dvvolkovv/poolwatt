import Link from "next/link";

export interface QuickAction {
  key: string;
  label: string;
  href: string;
  glyph: string;
}

/** §22.2 — "быстрые кнопки: «Купить», «Перевести», «Зарядиться», «Пополнить»". */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="grid grid-cols-4 gap-2 mt-6">
      {actions.map((a) => (
        <Link
          key={a.key}
          href={a.href}
          data-action={a.key}
          className="flex flex-col items-center gap-2 rounded-lg bg-card
                     border border-hairline py-3 text-[11px] text-muted-strong"
        >
          <span aria-hidden className="text-[20px] leading-none text-accent">
            {a.glyph}
          </span>
          {a.label}
        </Link>
      ))}
    </div>
  );
}
