"use client";

// §48 / US-51 — one card on the board: who is answerable, by when, and the
// buttons that move it along, lose it or comment on it.

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  deleteLeadAction,
  lostLeadAction,
  moveLeadAction,
  noteLeadAction,
  reopenLeadAction,
  updateLeadAction,
} from "@/app/[locale]/me/charger-operator/[id]/pipeline/actions";

export interface LeadCardLabels {
  owner: string;
  nobody: string;
  due: string;
  overdue: string;
  moveTo: string;
  comment: string;
  send: string;
  lost: string;
  lostWhy: string;
  reopen: string;
  remove: string;
  notes: string;
  documents: string;
  save: string;
  stageNames: Record<string, string>;
}

export function LeadCard({
  lead,
  stages,
  employees,
  locale,
  operatorId,
  labels,
}: {
  lead: {
    id: string;
    title: string;
    city: string | null;
    stage: string;
    ownerEmployeeId: string | null;
    ownerName: string | null;
    dueAt: string | null;
    overdue: boolean;
    noteCount: number;
    documentCount: number;
    lostReason: string | null;
  };
  stages: string[];
  employees: { id: string; name: string }[];
  locale: string;
  operatorId: string;
  labels: LeadCardLabels;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [ownerEmployeeId, setOwnerEmployeeId] = useState(lead.ownerEmployeeId ?? "");
  const [dueAt, setDueAt] = useState(lead.dueAt ? lead.dueAt.slice(0, 16) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; formError?: string }>) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.formError ?? "Could not do that.");
    });

  return (
    <article
      className={`rounded border p-2.5 text-[13px] ${
        lead.lostReason
          ? "border-hairline opacity-60"
          : lead.overdue
            ? "border-down"
            : "border-hairline"
      }`}
      data-testid={`lead-${lead.id}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left font-medium hover:text-accent"
      >
        {lead.title}
      </button>
      <p className="mt-0.5 text-[12px] text-muted">
        {lead.city ?? "—"}
        {" · "}
        {lead.ownerName ?? labels.nobody}
        {lead.dueAt && (
          <>
            {" · "}
            <span className={`num ${lead.overdue ? "text-down" : ""}`}>
              {lead.dueAt.slice(0, 10)}
            </span>
            {lead.overdue && ` · ${labels.overdue}`}
          </>
        )}
        {(lead.noteCount > 0 || lead.documentCount > 0) && (
          <>
            {" · "}
            <span className="num">{lead.noteCount}</span> {labels.notes}
            {" · "}
            <span className="num">{lead.documentCount}</span> {labels.documents}
          </>
        )}
      </p>
      {lead.lostReason && (
        <p className="mt-1 text-[12px] text-down" data-testid={`lost-${lead.id}`}>
          {labels.lost}: {lead.lostReason}
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-2 border-t border-hairline pt-2">
          <Link
            href={`/${locale}/me/charger-operator/${operatorId}/pipeline/${lead.id}`}
            prefetch={false}
            className="text-[12px] underline hover:text-accent"
          >
            {labels.documents} →
          </Link>

          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
              {labels.moveTo}
            </span>
            <select
              value={lead.stage}
              disabled={pending}
              onChange={(e) =>
                run(() => moveLeadAction({ leadId: lead.id, stage: e.target.value }))
              }
              aria-label={`${labels.moveTo} ${lead.title}`}
              className="w-full rounded border border-hairline bg-bg px-2 py-1 text-[13px]"
            >
              {stages.map((s) => (
                <option key={s} value={s}>
                  {labels.stageNames[s]}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
                {labels.owner}
              </span>
              <select
                value={ownerEmployeeId}
                onChange={(e) => setOwnerEmployeeId(e.target.value)}
                aria-label={`${labels.owner} ${lead.title}`}
                className="rounded border border-hairline bg-bg px-2 py-1 text-[13px]"
              >
                <option value="">{labels.nobody}</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
                {labels.due}
              </span>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                aria-label={`${labels.due} ${lead.title}`}
                className="rounded border border-hairline bg-bg px-2 py-1 text-[13px]"
              />
            </label>
            <button
              type="button"
              disabled={pending}
              data-testid={`save-lead-${lead.id}`}
              onClick={() =>
                run(() =>
                  updateLeadAction({
                    leadId: lead.id,
                    ownerEmployeeId: ownerEmployeeId || null,
                    dueAt: dueAt ? new Date(dueAt).toISOString() : null,
                  }),
                )
              }
              className="rounded border border-accent px-2 py-1 text-[12px] text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {labels.save}
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block grow">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
                {labels.comment}
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label={`${labels.comment} ${lead.title}`}
                className="w-full rounded border border-hairline bg-bg px-2 py-1 text-[13px]"
              />
            </label>
            <button
              type="button"
              disabled={pending || note.trim() === ""}
              onClick={() =>
                run(async () => {
                  const r = await noteLeadAction({ leadId: lead.id, text: note });
                  if (r.ok) setNote("");
                  return r;
                })
              }
              className="rounded border border-hairline px-2 py-1 text-[12px] hover:border-accent disabled:opacity-50"
            >
              {labels.send}
            </button>
          </div>

          {lead.lostReason ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => reopenLeadAction({ leadId: lead.id }))}
              className="rounded border border-hairline px-2 py-1 text-[12px] hover:border-accent disabled:opacity-50"
            >
              {labels.reopen}
            </button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block grow">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
                  {labels.lostWhy}
                </span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-label={`${labels.lostWhy} ${lead.title}`}
                  className="w-full rounded border border-hairline bg-bg px-2 py-1 text-[13px]"
                />
              </label>
              <button
                type="button"
                disabled={pending || reason.trim().length < 2}
                data-testid={`lose-lead-${lead.id}`}
                onClick={() => run(() => lostLeadAction({ leadId: lead.id, reason }))}
                className="rounded border border-hairline px-2 py-1 text-[12px] text-muted hover:border-down disabled:opacity-50"
              >
                {labels.lost}
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => deleteLeadAction({ leadId: lead.id }))}
            className="text-[12px] text-muted underline hover:text-down disabled:opacity-50"
          >
            {labels.remove}
          </button>

          {error && <p className="text-[12px] text-down">{error}</p>}
        </div>
      )}
    </article>
  );
}
