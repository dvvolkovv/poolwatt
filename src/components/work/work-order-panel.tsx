"use client";

// One work order as the engineer works it — ТЗ §48.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapsDeepLink } from "@/components/maps-deep-link";
import { advanceOrder, assignOrder } from "@/app/[locale]/me/work-orders/actions";

type Status =
  | "NEW"
  | "ASSIGNED"
  | "EN_ROUTE"
  | "IN_PROGRESS"
  | "WAITING_PART"
  | "DONE"
  | "VERIFIED"
  | "CANCELLED";

/** Mirrors the service's table; the service is the one that enforces it. */
const NEXT: Record<Status, Status[]> = {
  NEW: ["CANCELLED"],
  ASSIGNED: ["EN_ROUTE", "IN_PROGRESS", "CANCELLED"],
  EN_ROUTE: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["WAITING_PART", "DONE", "CANCELLED"],
  WAITING_PART: ["IN_PROGRESS", "CANCELLED"],
  DONE: ["VERIFIED", "IN_PROGRESS"],
  VERIFIED: [],
  CANCELLED: [],
};

export function WorkOrderPanel({
  order,
  staff,
  canAssign,
  labels,
}: {
  order: {
    id: string;
    status: string;
    description: string;
    partsNeeded: string[];
    photos: string[];
    report: string | null;
    assigneeId: string | null;
    where: string;
    howToFind: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  staff: { id: string; username: string }[];
  canAssign: boolean;
  labels: {
    where: string;
    howToFind: string;
    fault: string;
    parts: string;
    photos: string;
    report: string;
    reportPlaceholder: string;
    assign: string;
    assignee: string;
    route: string;
    statusNames: Record<string, string>;
  };
}) {
  const router = useRouter();
  const [report, setReport] = useState(order.report ?? "");
  const [assignee, setAssignee] = useState(order.assigneeId ?? staff[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const next = NEXT[(order.status as Status) ?? "NEW"] ?? [];

  return (
    <div className="space-y-6" data-testid="work-order">
      <section>
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted">{labels.where}</h2>
        <p className="text-sm">{order.where || "—"}</p>
        {order.howToFind && (
          <p className="mt-1 text-[13px] text-muted">
            {labels.howToFind}: {order.howToFind}
          </p>
        )}
        {order.latitude != null && order.longitude != null && (
          <div className="mt-2">
            <MapsDeepLink
              lat={order.latitude}
              lng={order.longitude}
              label={labels.route}
              className="rounded border border-hairline px-3 py-1.5 text-[13px] hover:border-accent"
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted">{labels.fault}</h2>
        <pre className="whitespace-pre-wrap text-sm">{order.description}</pre>
      </section>

      {order.partsNeeded.length > 0 && (
        <section>
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted">{labels.parts}</h2>
          <ul className="text-sm" data-testid="work-order-parts">
            {order.partsNeeded.map((p) => (
              <li key={p}>· {p}</li>
            ))}
          </ul>
        </section>
      )}

      {order.photos.length > 0 && (
        <section>
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted">{labels.photos}</h2>
          <ul className="text-[12px] text-muted">
            {order.photos.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {canAssign && staff.length > 0 && (
        <section>
          <h2 className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.assignee}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              aria-label={labels.assignee}
              className="rounded border border-hairline bg-bg px-2 py-1 text-[13px]"
            >
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  @{s.username}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || !assignee}
              onClick={() =>
                run(() => assignOrder({ workOrderId: order.id, employeeId: assignee }))
              }
              className="rounded border border-hairline px-3 py-1 text-[13px] hover:border-accent disabled:opacity-50"
            >
              {labels.assign}
            </button>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.report}
        </h2>
        <textarea
          value={report}
          onChange={(e) => setReport(e.target.value)}
          placeholder={labels.reportPlaceholder}
          aria-label={labels.report}
          rows={3}
          className="w-full rounded border border-hairline bg-bg px-3 py-2 text-sm"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {next.map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`advance-${s}`}
              disabled={pending}
              onClick={() =>
                run(() =>
                  advanceOrder({
                    workOrderId: order.id,
                    status: s,
                    report: report.trim() || null,
                  }),
                )
              }
              className="rounded border border-hairline px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-50"
            >
              {labels.statusNames[s] ?? s}
            </button>
          ))}
        </div>
      </section>

      {error && <p className="text-[13px] text-down">{error}</p>}
    </div>
  );

  function run(action: () => Promise<{ ok: boolean; formError?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) setError(r.formError ?? "Could not update.");
      else router.refresh();
    });
  }
}
