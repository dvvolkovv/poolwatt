"use client";

// §24 — «возможна отмена только до подтверждения получателем», если включён
// режим запроса. Здесь получатель принимает или отклоняет то, что ему
// отправили.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function IncomingTransfers({
  rows,
  labels,
  accept,
  decline,
}: {
  rows: { id: string; from: string; amountKwh: number; note: string | null; at: string }[];
  labels: { incoming: string; accept: string; decline: string; noIncoming: string };
  accept: (id: string) => Promise<{ ok: boolean; error?: string }>;
  decline: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(action: (id: string) => Promise<{ ok: boolean; error?: string }>, id: string) {
    setError(null);
    start(async () => {
      const result = await action(id);
      if (result.ok) router.refresh();
      else setError(result.error ?? "Could not do that");
    });
  }

  return (
    <section className="mt-6" data-testid="incoming-transfers">
      <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">{labels.incoming}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">{labels.noIncoming}</p>
      ) : (
        <ul className="mt-2 divide-y divide-hairline rounded-lg border border-hairline bg-card">
          {rows.map((r) => (
            <li key={r.id} className="px-3 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px]">{r.from}</span>
                <span className="num text-[16px]">{r.amountKwh.toFixed(3)} kWh</span>
              </div>
              {r.note && <p className="mt-0.5 text-[12px] text-muted">{r.note}</p>}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(accept, r.id)}
                  data-testid="incoming-accept"
                  className="flex-1 rounded-full bg-accent py-2.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-accent-foreground disabled:opacity-50"
                >
                  {labels.accept}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(decline, r.id)}
                  data-testid="incoming-decline"
                  className="rounded-full border border-hairline px-4 py-2.5 text-[12px] uppercase tracking-[0.16em] text-muted disabled:opacity-50"
                >
                  {labels.decline}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-2 text-[13px] text-down" data-testid="incoming-error">
          {error}
        </p>
      )}
    </section>
  );
}
