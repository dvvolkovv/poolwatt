"use client";

// §48 на мониторе: чек-лист с отметками, снимки «до» и «после», подпись.
//
// Отмечать можно и отсюда — работу иногда ведёт тот, кто сидит за столом с
// инженером на связи. Правило одно и то же, что у телефона: `tickTask` и
// `skipTask` из `work-order-checklist.ts`, а не своя копия.
//
// Фотографировать и подписывать отсюда нельзя: у монитора нет ни камеры с
// места, ни человека, который принимает работу. Снимки и подпись он
// показывает.

import { useEffect, useState, useTransition } from "react";
import { answerOrderTask } from "@/app/[locale]/me/work-orders/actions";

export interface SitePanelTask {
  id: string;
  position: number;
  title: string;
  required: boolean;
  doneAt: string | null;
  skipReason: string | null;
}

export function WorkOrderSitePanel({
  workOrderId,
  tasks,
  before,
  after,
  signature,
  canWork,
  labels,
}: {
  workOrderId: string;
  tasks: SitePanelTask[];
  before: { key: string }[];
  after: { key: string }[];
  signature: { signerKind: string; signerName: string; key: string; signedAt: string } | null;
  canWork: boolean;
  labels: {
    checklist: string;
    skip: string;
    skipReason: string;
    skipped: string;
    save: string;
    cancel: string;
    photosBefore: string;
    photosAfter: string;
    noPhotos: string;
    signature: string;
    noSignature: string;
    signedBy: string;
    signerSiteContact: string;
    signerEngineer: string;
  };
}) {
  // Отметка держится в состоянии, а не только в пропсах: управляемый
  // checkbox без него возвращается в прежнее положение сразу после нажатия и
  // ждёт ревалидации — для человека это «кнопка не нажимается».
  const [local, setLocal] = useState(tasks);
  const [skipping, setSkipping] = useState<string | null>(null);
  const [words, setWords] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Сервер мог отрисовать другое (ревалидация, отметка с телефона).
  useEffect(() => setLocal(tasks), [tasks]);

  function answer(taskId: string, done: boolean, skipReason?: string) {
    setError(null);
    setLocal((rows) =>
      rows.map((row) =>
        row.id === taskId
          ? {
              ...row,
              doneAt: done ? new Date().toISOString() : null,
              skipReason: skipReason ?? null,
            }
          : row,
      ),
    );
    startTransition(async () => {
      const result = await answerOrderTask({
        workOrderId,
        taskId,
        ...(skipReason ? { skipReason } : { done }),
      });
      if (!result.ok) {
        setError(result.formError);
        // Отказ возвращает экран к тому, что знает сервер.
        setLocal(tasks);
      }
    });
  }

  return (
    <div className="mt-8 space-y-8">
      <section data-testid="order-checklist">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.checklist}
        </h2>
        <ul className="mt-2 divide-y divide-hairline rounded border border-hairline">
          {local.map((task) => (
            <li key={task.id} className="px-3 py-2" data-task={task.id}>
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={task.doneAt !== null}
                  disabled={!canWork || pending}
                  onChange={(event) => answer(task.id, event.target.checked)}
                  data-testid={`order-task-${task.position}`}
                  className="mt-0.5"
                />
                <span className={task.doneAt ? "text-muted line-through" : undefined}>
                  {task.title}
                </span>
              </label>
              {task.skipReason && (
                <p className="mt-0.5 pl-6 text-[12px] text-muted">
                  {labels.skipped}: {task.skipReason}
                </p>
              )}
              {canWork && !task.doneAt && (
                skipping === task.id ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 pl-6">
                    <input
                      value={words}
                      onChange={(event) => setWords(event.target.value)}
                      placeholder={labels.skipReason}
                      className="min-w-[200px] flex-1 rounded border border-hairline bg-transparent px-2 py-1 text-[12px]"
                    />
                    <button
                      type="button"
                      disabled={words.trim().length === 0}
                      onClick={() => {
                        answer(task.id, false, words.trim());
                        setSkipping(null);
                        setWords("");
                      }}
                      className="rounded bg-accent px-3 py-1 text-[12px] text-background disabled:opacity-50"
                    >
                      {labels.save}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSkipping(null);
                        setWords("");
                      }}
                      className="text-[12px] text-muted underline"
                    >
                      {labels.cancel}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSkipping(task.id)}
                    className="mt-0.5 pl-6 text-[12px] text-muted underline"
                  >
                    {labels.skip}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
        {error && (
          <p className="mt-2 text-[12px] text-down" data-testid="order-checklist-error">
            {error}
          </p>
        )}
      </section>

      <Strip label={labels.photosBefore} photos={before} empty={labels.noPhotos} stage="BEFORE" />
      <Strip label={labels.photosAfter} photos={after} empty={labels.noPhotos} stage="AFTER" />

      <section data-testid="order-signature">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.signature}
        </h2>
        {signature ? (
          <div className="mt-2">
            {/* Свой маршрут, своё право; next/image здесь ничего не даёт. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/v1/work-order-media/${signature.key}`}
              alt={labels.signature}
              className="h-24 w-auto rounded border border-hairline bg-white"
            />
            <p className="mt-1 text-[12px] text-muted">
              {labels.signedBy}: {signature.signerName} ·{" "}
              {signature.signerKind === "ENGINEER"
                ? labels.signerEngineer
                : labels.signerSiteContact}{" "}
              · <span className="num">{signature.signedAt.slice(0, 16).replace("T", " ")}</span>
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-muted">{labels.noSignature}</p>
        )}
      </section>
    </div>
  );
}

function Strip({
  label,
  photos,
  empty,
  stage,
}: {
  label: string;
  photos: { key: string }[];
  empty: string;
  stage: string;
}) {
  return (
    <section data-testid={`order-photos-${stage}`}>
      <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</h2>
      {photos.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {photos.map((photo) => (
            <li key={photo.key}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/v1/work-order-media/${photo.key}`}
                alt={label}
                className="h-28 w-28 rounded border border-hairline object-cover"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
