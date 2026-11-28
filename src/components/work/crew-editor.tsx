"use client";

// Бригады и охват инженеров — ТЗ §48 «Назначение инженеру или бригаде с
// учётом региона».
//
// Живёт на странице сотрудников §47, а не рядом с очередью диспетчера: город
// и бригада — это свойства состава сети, их меняют тогда же, когда роль и
// пункты, и в одном месте.
//
// Поле городов показывается не всем: подбор берёт только тех, кому роль §47
// разрешает `workorders.write`. У бухгалтера город не значил бы ничего, а
// пустое поле рядом с его именем читалось бы как «ещё не заполнили».

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addCrew,
  addMember,
  dropCrew,
  dropMember,
  saveCrewRegions,
  saveEmployeeRegions,
} from "@/app/[locale]/me/charger-operator/[id]/staff/actions";

export interface CrewEditorCrew {
  id: string;
  name: string;
  regions: string[];
  openOrders: number;
  members: { employeeId: string; username: string; lead: boolean }[];
}

export interface CrewEditorEmployee {
  id: string;
  username: string;
  regions: string[];
}

export interface CrewEditorLabels {
  title: string;
  help: string;
  add: string;
  name: string;
  regions: string;
  regionsHint: string;
  members: string;
  lead: string;
  addMember: string;
  remove: string;
  empty: string;
  wholeNetwork: string;
  save: string;
  employeeRegions: string;
}

const FIELD =
  "mt-1 w-full rounded-lg border border-hairline bg-transparent p-2 text-sm text-foreground";

export function CrewEditor({
  operatorId,
  crews,
  engineers,
  labels,
}: {
  operatorId: string;
  crews: CrewEditorCrew[];
  engineers: CrewEditorEmployee[];
  labels: CrewEditorLabels;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Черновики полей держатся здесь: управляемый input без своего состояния
  // возвращается в прежнее значение до ревалидации, и человек видит
  // «не печатается».
  const [personCities, setPersonCities] = useState<Record<string, string>>(() =>
    Object.fromEntries(engineers.map((e) => [e.id, e.regions.join(", ")])),
  );
  const [crewCities, setCrewCities] = useState<Record<string, string>>(() =>
    Object.fromEntries(crews.map((c) => [c.id, c.regions.join(", ")])),
  );
  const [pick, setPick] = useState<Record<string, { employeeId: string; lead: boolean }>>({});
  const [draft, setDraft] = useState({ name: "", regions: "" });

  function run(action: () => Promise<{ ok: boolean; formError?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.formError ?? "Could not save.");
        return;
      }
      router.refresh();
    });
  }

  function memberPick(crewId: string) {
    return pick[crewId] ?? { employeeId: "", lead: false };
  }

  return (
    <section className="mt-12" data-testid="crew-editor">
      <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted">{labels.title}</h2>
      <p className="mb-6 mt-2 max-w-[80ch] text-[13px] text-muted">{labels.help}</p>

      {error && (
        <p className="mb-4 rounded-xl border border-down/40 bg-down/10 p-3 text-sm" role="alert">
          {error}
        </p>
      )}

      {engineers.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-2 text-[12px] font-medium">{labels.employeeRegions}</h3>
          <ul className="divide-y divide-hairline">
            {engineers.map((e) => (
              <li key={e.id} className="flex flex-wrap items-end gap-3 py-2">
                <span className="w-[14ch] shrink-0 text-[13px]">@{e.username}</span>
                <label className="min-w-[24ch] flex-1 text-[12px] text-muted">
                  {labels.regions}
                  <input
                    value={personCities[e.id] ?? ""}
                    onChange={(ev) =>
                      setPersonCities({ ...personCities, [e.id]: ev.target.value })
                    }
                    placeholder={labels.regionsHint}
                    data-testid={`crew-employee-regions-${e.username}`}
                    className={FIELD}
                  />
                </label>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      saveEmployeeRegions({ id: e.id, regions: personCities[e.id] ?? "" }),
                    )
                  }
                  className="rounded-lg border border-hairline px-3 py-2 text-[12px] disabled:opacity-50"
                >
                  {labels.save}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {crews.length === 0 ? (
        <p className="mb-8 text-sm text-muted">{labels.empty}</p>
      ) : (
        <ul className="mb-8 space-y-5" data-testid="crew-list">
          {crews.map((c) => {
            const chosen = memberPick(c.id);
            const free = engineers.filter(
              (e) => !c.members.some((m) => m.employeeId === e.id),
            );
            return (
              <li key={c.id} className="rounded-xl border border-hairline p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {c.name}
                    <span className="ml-2 text-[11px] text-muted">
                      {c.regions.length > 0 ? c.regions.join(", ") : labels.wholeNetwork}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => dropCrew(c.id))}
                    className="text-[12px] text-muted underline hover:text-down disabled:opacity-50"
                  >
                    {labels.remove}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="min-w-[24ch] flex-1 text-[12px] text-muted">
                    {labels.regions}
                    <input
                      value={crewCities[c.id] ?? ""}
                      onChange={(ev) => setCrewCities({ ...crewCities, [c.id]: ev.target.value })}
                      placeholder={labels.regionsHint}
                      data-testid={`crew-regions-${c.id}`}
                      className={FIELD}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() => saveCrewRegions({ id: c.id, regions: crewCities[c.id] ?? "" }))
                    }
                    className="rounded-lg border border-hairline px-3 py-2 text-[12px] disabled:opacity-50"
                  >
                    {labels.save}
                  </button>
                </div>

                <h4 className="mt-4 text-[11px] uppercase tracking-[0.14em] text-muted">
                  {labels.members}
                </h4>
                {c.members.length === 0 ? (
                  <p className="mt-1 text-[12px] text-muted">—</p>
                ) : (
                  <ul className="mt-1 divide-y divide-hairline">
                    {c.members.map((m) => (
                      <li
                        key={m.employeeId}
                        className="flex items-baseline justify-between gap-2 py-1.5 text-[13px]"
                      >
                        <span>
                          @{m.username}
                          {m.lead && (
                            <span className="ml-2 text-[11px] uppercase tracking-[0.1em] text-accent">
                              {labels.lead}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(() => dropMember({ crewId: c.id, employeeId: m.employeeId }))
                          }
                          className="text-[12px] underline hover:text-down disabled:opacity-50"
                        >
                          {labels.remove}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {free.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="text-[12px] text-muted">
                      {labels.addMember}
                      <select
                        value={chosen.employeeId}
                        onChange={(ev) =>
                          setPick({
                            ...pick,
                            [c.id]: { ...chosen, employeeId: ev.target.value },
                          })
                        }
                        data-testid={`crew-member-pick-${c.id}`}
                        className={FIELD}
                      >
                        <option value="">—</option>
                        {free.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.username}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 pb-2 text-[12px] text-muted">
                      <input
                        type="checkbox"
                        checked={chosen.lead}
                        onChange={(ev) =>
                          setPick({ ...pick, [c.id]: { ...chosen, lead: ev.target.checked } })
                        }
                      />
                      {labels.lead}
                    </label>
                    <button
                      type="button"
                      disabled={pending || !chosen.employeeId}
                      onClick={() =>
                        run(async () => {
                          const result = await addMember({
                            crewId: c.id,
                            employeeId: chosen.employeeId,
                            lead: chosen.lead,
                          });
                          if (result.ok) setPick({ ...pick, [c.id]: { employeeId: "", lead: false } });
                          return result;
                        })
                      }
                      data-testid={`crew-member-add-${c.id}`}
                      className="rounded-lg border border-hairline px-3 py-2 text-[12px] disabled:opacity-50"
                    >
                      {labels.addMember}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[12px] text-muted">
          {labels.name}
          <input
            value={draft.name}
            onChange={(ev) => setDraft({ ...draft, name: ev.target.value })}
            data-testid="crew-new-name"
            className={FIELD}
          />
        </label>
        <label className="min-w-[24ch] flex-1 text-[12px] text-muted">
          {labels.regions}
          <input
            value={draft.regions}
            onChange={(ev) => setDraft({ ...draft, regions: ev.target.value })}
            placeholder={labels.regionsHint}
            data-testid="crew-new-regions"
            className={FIELD}
          />
        </label>
        <button
          type="button"
          disabled={pending || draft.name.trim().length < 2}
          onClick={() =>
            run(async () => {
              const result = await addCrew({ operatorId, ...draft });
              if (result.ok) setDraft({ name: "", regions: "" });
              return result;
            })
          }
          data-testid="crew-add"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {labels.add}
        </button>
      </div>
    </section>
  );
}
