"use client";

// Рабочее место диспетчера — ТЗ §48: очередь, подбор исполнителя и ручное
// создание наряда.
//
// Неназначенные строки стоят первыми (это решает сервер) и помечены: только
// они требуют решения прямо сейчас. Кандидаты запрашиваются по нажатию, а не
// вперёд для всей очереди: у сети с сотней открытых нарядов это сотня
// подборов, которых никто не просил.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assignFromQueue,
  candidatesFor,
  createOrder,
} from "@/app/[locale]/me/charger-operator/[id]/dispatch/actions";

export interface DispatchRow {
  id: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  where: string;
  assignee: { kind: string; name: string } | null;
  createdAt: string;
  partsNeeded: string[];
}

export interface DispatchCandidate {
  kind: string;
  id: string;
  name: string;
  regions: string[];
  openOrders: number;
  reason: string;
  members: string[];
}

export interface DispatchLoadRow {
  kind: string;
  id: string;
  name: string;
  regions: string[];
  openOrders: number;
  members: string[];
}

export interface DispatchLabels {
  queue: string;
  unassigned: string;
  assign: string;
  assignee: string;
  candidatesEmpty: string;
  load: string;
  loadOpen: string;
  loadRegions: string;
  wholeNetwork: string;
  reason: Record<string, string>;
  statusNames: Record<string, string>;
  typeNames: Record<string, string>;
  priorityNames: Record<string, string>;
  create: string;
  createTitle: string;
  createDescription: string;
  createPoint: string;
  createType: string;
  createPriority: string;
  createParts: string;
  createPartsHint: string;
  createSubmit: string;
  created: string;
  empty: string;
  age: string;
  crew: string;
  engineer: string;
}

const TYPES = ["REPAIR", "MAINTENANCE", "INSTALL", "COMPLAINT_CHECK"] as const;
const PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;

function ageInHours(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
}

export function DispatchBoard({
  operatorId,
  rows,
  load,
  points,
  canAssign,
  labels,
}: {
  operatorId: string;
  rows: DispatchRow[];
  load: DispatchLoadRow[];
  points: { id: string; name: string; city: string | null }[];
  canAssign: boolean;
  labels: DispatchLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, DispatchCandidate[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [pending, startTransition] = useTransition();

  const [form, setForm] = useState({
    pointId: points[0]?.id ?? "",
    type: "REPAIR" as (typeof TYPES)[number],
    priority: "NORMAL" as (typeof PRIORITIES)[number],
    title: "",
    description: "",
    partsNeeded: "",
  });

  function show(workOrderId: string) {
    setError(null);
    if (open === workOrderId) {
      setOpen(null);
      return;
    }
    setOpen(workOrderId);
    if (candidates[workOrderId]) return;
    startTransition(async () => {
      const result = await candidatesFor(operatorId, workOrderId);
      if (!result.ok) {
        setError(result.formError);
        return;
      }
      setCandidates((prev) => ({
        ...prev,
        [workOrderId]: ("candidates" in result ? result.candidates : []) as DispatchCandidate[],
      }));
    });
  }

  function assign(workOrderId: string, candidate: DispatchCandidate) {
    setError(null);
    startTransition(async () => {
      const result = await assignFromQueue({
        operatorId,
        workOrderId,
        ...(candidate.kind === "crew" ? { crewId: candidate.id } : { employeeId: candidate.id }),
      });
      if (!result.ok) {
        setError(result.formError);
        return;
      }
      setOpen(null);
      setCandidates({});
      router.refresh();
    });
  }

  function submit() {
    setError(null);
    setCreated(false);
    startTransition(async () => {
      const result = await createOrder({ operatorId, ...form });
      if (!result.ok) {
        setError(result.formError);
        return;
      }
      setCreated(true);
      setForm((prev) => ({ ...prev, title: "", description: "", partsNeeded: "" }));
      setCandidates({});
      router.refresh();
    });
  }

  return (
    <div className="space-y-10">
      {error && (
        <p className="rounded-xl border border-down/40 bg-down/10 p-3 text-sm" role="alert">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-3 text-[11px] uppercase tracking-[0.14em] text-muted">{labels.queue}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{labels.empty}</p>
        ) : (
          <ul className="divide-y divide-hairline" data-testid="dispatch-queue">
            {rows.map((row) => (
              <li key={row.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{row.title}</span>
                  <span className="text-[12px] text-muted">
                    {labels.typeNames[row.type] ?? row.type} ·{" "}
                    {labels.priorityNames[row.priority] ?? row.priority} ·{" "}
                    {labels.statusNames[row.status] ?? row.status} ·{" "}
                    <span className="num">{ageInHours(row.createdAt)}</span> {labels.age}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-muted">{row.where || "—"}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px]">
                  {row.assignee ? (
                    <span>
                      {row.assignee.kind === "crew" ? labels.crew : labels.engineer}:{" "}
                      <b>{row.assignee.name}</b>
                    </span>
                  ) : (
                    <span className="rounded bg-down/15 px-1.5 py-0.5 text-down">
                      {labels.unassigned}
                    </span>
                  )}
                  {canAssign && (
                    <button
                      type="button"
                      onClick={() => show(row.id)}
                      disabled={pending}
                      className="underline hover:text-accent"
                    >
                      {labels.assign}
                    </button>
                  )}
                </div>

                {open === row.id && (
                  <ul className="mt-2 space-y-1 rounded-xl bg-hairline/20 p-2" data-testid="dispatch-candidates">
                    {(candidates[row.id] ?? []).length === 0 ? (
                      <li className="text-[12px] text-muted">
                        {pending ? "…" : labels.candidatesEmpty}
                      </li>
                    ) : (
                      (candidates[row.id] ?? []).map((c) => (
                        <li key={`${c.kind}-${c.id}`} className="flex items-baseline justify-between gap-2">
                          <span className="text-[13px]">
                            {c.kind === "crew" ? `${labels.crew}: ` : "@"}
                            {c.name}
                            <span className="ml-2 text-[11px] text-muted">
                              {labels.reason[c.reason] ?? c.reason} ·{" "}
                              <span className="num">{c.openOrders}</span>
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => assign(row.id, c)}
                            disabled={pending}
                            className="text-[12px] underline hover:text-accent"
                          >
                            {labels.assign}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="dispatch-load">
        <h2 className="mb-3 text-[11px] uppercase tracking-[0.14em] text-muted">{labels.load}</h2>
        <ul className="divide-y divide-hairline">
          {load.map((row) => (
            <li key={`${row.kind}-${row.id}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[13px]">
              <span>
                {row.kind === "crew" ? `${labels.crew}: ` : "@"}
                {row.name}
                {row.kind === "crew" && row.members.length > 0 && (
                  <span className="ml-2 text-[11px] text-muted">{row.members.join(", ")}</span>
                )}
              </span>
              <span className="text-[12px] text-muted">
                {row.regions.length > 0 ? row.regions.join(", ") : labels.wholeNetwork} ·{" "}
                <span className="num">{row.openOrders}</span> {labels.loadOpen}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {canAssign && (
        <section data-testid="dispatch-create">
          <h2 className="mb-3 text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.create}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[12px] text-muted">
              {labels.createPoint}
              <select
                value={form.pointId}
                onChange={(e) => setForm({ ...form, pointId: e.target.value })}
                className="mt-1 w-full rounded-lg border border-hairline bg-transparent p-2 text-sm text-foreground"
              >
                {points.map((p) => (
                  <option key={p.id} value={p.id}>
                    {[p.name, p.city].filter(Boolean).join(", ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-muted">
              {labels.createType}
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as (typeof TYPES)[number] })}
                className="mt-1 w-full rounded-lg border border-hairline bg-transparent p-2 text-sm text-foreground"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {labels.typeNames[t] ?? t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-muted">
              {labels.createPriority}
              <select
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: e.target.value as (typeof PRIORITIES)[number] })
                }
                className="mt-1 w-full rounded-lg border border-hairline bg-transparent p-2 text-sm text-foreground"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {labels.priorityNames[p] ?? p}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-muted">
              {labels.createTitle}
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                data-testid="dispatch-title"
                className="mt-1 w-full rounded-lg border border-hairline bg-transparent p-2 text-sm text-foreground"
              />
            </label>
            <label className="text-[12px] text-muted sm:col-span-2">
              {labels.createDescription}
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                data-testid="dispatch-description"
                className="mt-1 w-full rounded-lg border border-hairline bg-transparent p-2 text-sm text-foreground"
              />
            </label>
            <label className="text-[12px] text-muted sm:col-span-2">
              {labels.createParts}
              <input
                value={form.partsNeeded}
                onChange={(e) => setForm({ ...form, partsNeeded: e.target.value })}
                placeholder={labels.createPartsHint}
                className="mt-1 w-full rounded-lg border border-hairline bg-transparent p-2 text-sm text-foreground"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={pending || !form.title.trim() || !form.description.trim() || !form.pointId}
              data-testid="dispatch-submit"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              {labels.createSubmit}
            </button>
            {created && <span className="text-[12px] text-up">{labels.created}</span>}
          </div>
        </section>
      )}
    </div>
  );
}
