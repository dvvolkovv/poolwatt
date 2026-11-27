"use client";

// §48 на месте работ: чек-лист, снимки «до» и «после», подпись, закрытие.
//
// Отдельный компонент, а не ещё двести строк в экране наряда: у этого куска
// своё состояние — холст подписи, выбранный файл, открытое объяснение
// пропуска, — и держать его рядом со складским списанием значило бы один
// файл, в котором ничего не найти.
//
// Что переживает отсутствие связи, а что нет:
//
//   отметка пункта, подпись, закрытие — через очередь, как списание запчасти;
//   снимок — нет. Кадр с камеры 2–5 МБ, три таких не влезут в `localStorage`,
//   и очередь молча потеряла бы запись. Экран говорит это прямо, а не делает
//   вид, что снимок ушёл.

import { useEffect, useRef, useState, useTransition } from "react";
import type { NewOp } from "@/lib/mobile/offline-queue";

export interface SiteTask {
  id: string;
  position: number;
  title: string;
  required: boolean;
  doneAt: string | null;
  skipReason: string | null;
}

export interface SitePhoto {
  key: string;
  stage: "BEFORE" | "AFTER";
}

export interface SiteSignature {
  signerKind: "SITE_CONTACT" | "ENGINEER";
  signerName: string;
  key: string;
  signedAt: string;
}

export interface SiteWorkLabels {
  checklist: string;
  skip: string;
  skipReason: string;
  skipped: string;
  save: string;
  cancel: string;
  photosBefore: string;
  photosAfter: string;
  addPhoto: string;
  uploading: string;
  photoNeedsNetwork: string;
  signature: string;
  signerName: string;
  signerSiteContact: string;
  signerEngineer: string;
  signHere: string;
  clear: string;
  sign: string;
  signedBy: string;
  close: string;
  closing: string;
  closed: string;
}

export function WorkOrderSiteWork({
  workOrderId,
  status,
  tasks,
  photos,
  signature,
  canWork,
  labels,
  enqueueOp,
  refresh,
}: {
  workOrderId: string;
  status: string;
  tasks: SiteTask[];
  photos: SitePhoto[];
  signature: SiteSignature | null;
  canWork: boolean;
  labels: SiteWorkLabels;
  /** Поставить запись в очередь и попробовать отправить — даёт экран наряда. */
  enqueueOp: (op: NewOp) => void | Promise<void>;
  refresh: () => void;
}) {
  const [local, setLocal] = useState(tasks);
  const [skipping, setSkipping] = useState<string | null>(null);
  const [skipWords, setSkipWords] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"BEFORE" | "AFTER" | null>(null);
  const [signerName, setSignerName] = useState(signature?.signerName ?? "");
  const [signerKind, setSignerKind] = useState<"SITE_CONTACT" | "ENGINEER">(
    signature?.signerKind ?? "SITE_CONTACT",
  );
  const [signed, setSigned] = useState(signature !== null);
  const [pending, startTransition] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawing = useRef(false);
  const drew = useRef(false);

  // Сервер мог отрисовать другое: очередь досылает отметки и дёргает
  // `router.refresh()`, и экран должен показать то, что лежит в базе. Без
  // связи досыла нет, значит и обновления нет — отметка остаётся на экране,
  // где её и поставили.
  useEffect(() => {
    setLocal(tasks);
    if (signature) {
      setSigned(true);
      setSignerName(signature.signerName);
      setSignerKind(signature.signerKind);
    }
  }, [tasks, signature]);

  const closed = status === "DONE" || status === "VERIFIED" || status === "CANCELLED";
  const unanswered = local.filter((t) => t.required && !t.doneAt && !t.skipReason);

  async function answer(task: SiteTask, done: boolean, skipReason?: string) {
    setError(null);
    const at = new Date().toISOString();
    setLocal((rows) =>
      rows.map((row) =>
        row.id === task.id
          ? {
              ...row,
              doneAt: done ? at : null,
              skipReason: skipReason ?? null,
            }
          : row,
      ),
    );
    await enqueueOp({
      kind: "workorder.task",
      workOrderId,
      label: task.title,
      body: {
        taskId: task.id,
        ...(skipReason ? { skipReason } : { done }),
      },
    });
  }

  async function onPhoto(stage: "BEFORE" | "AFTER", file: File) {
    setError(null);
    if (!navigator.onLine) {
      setError(labels.photoNeedsNetwork);
      return;
    }
    setUploading(stage);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const res = await fetch(`/api/v1/work-orders/${workOrderId}/photos`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Снимок идёт без очереди, но ключ всё равно свой: повтор по
          // неловкому нажатию не должен удваивать кадр.
          "idempotency-key": `photo-${stage}-${file.name}-${file.size}-${file.lastModified}`,
        },
        body: JSON.stringify({ stage, filename: file.name, base64: btoa(binary) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? labels.photoNeedsNetwork);
        return;
      }
      startTransition(refresh);
    } catch {
      setError(labels.photoNeedsNetwork);
    } finally {
      setUploading(null);
    }
  }

  function strokeStart(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    ctx.beginPath();
    ctx.moveTo(event.clientX - rect.left, event.clientY - rect.top);
  }

  function strokeMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(event.clientX - rect.left, event.clientY - rect.top);
    ctx.stroke();
    drew.current = true;
  }

  function strokeEnd() {
    drawing.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drew.current = false;
  }

  async function onSign() {
    setError(null);
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!drew.current) {
      setError(labels.signHere);
      return;
    }
    if (signerName.trim().length === 0) {
      setError(labels.signerName);
      return;
    }
    const base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
    await enqueueOp({
      kind: "workorder.signature",
      workOrderId,
      label: `${labels.signature}: ${signerName.trim()}`,
      body: { signerKind, signerName: signerName.trim(), base64 },
    });
    setSigned(true);
  }

  async function onClose() {
    setError(null);
    await enqueueOp({
      kind: "workorder.status",
      workOrderId,
      label: labels.close,
      body: { status: "DONE" },
    });
  }

  const before = photos.filter((p) => p.stage === "BEFORE");
  const after = photos.filter((p) => p.stage === "AFTER");

  return (
    <>
      <section className="mt-5" data-testid="site-checklist">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
          {labels.checklist}
        </div>
        <ul className="mt-2 divide-y divide-hairline rounded-lg border border-hairline bg-card">
          {local.map((task) => (
            <li key={task.id} className="px-3 py-2.5" data-task={task.id}>
              <label className="flex items-start gap-2.5 text-[14px]">
                <input
                  type="checkbox"
                  checked={task.doneAt !== null}
                  disabled={!canWork || closed}
                  onChange={(event) => void answer(task, event.target.checked)}
                  data-testid={`task-tick-${task.position}`}
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span className={task.doneAt ? "text-muted line-through" : undefined}>
                  {task.title}
                  {!task.required && " ·"}
                </span>
              </label>

              {task.skipReason && (
                <p className="mt-1 pl-8 text-[12px] text-muted" data-testid="task-skipped">
                  {labels.skipped}: {task.skipReason}
                </p>
              )}

              {canWork && !closed && !task.doneAt && (
                skipping === task.id ? (
                  <div className="mt-1.5 pl-8">
                    <input
                      value={skipWords}
                      onChange={(event) => setSkipWords(event.target.value)}
                      placeholder={labels.skipReason}
                      data-testid="task-skip-reason"
                      className="w-full rounded border border-hairline bg-transparent px-2 py-1 text-[13px]"
                    />
                    <div className="mt-1.5 flex gap-2">
                      <button
                        type="button"
                        disabled={skipWords.trim().length === 0}
                        onClick={() => {
                          void answer(task, false, skipWords.trim());
                          setSkipping(null);
                          setSkipWords("");
                        }}
                        data-testid="task-skip-save"
                        className="rounded bg-accent px-3 py-1 text-[12px] text-background disabled:opacity-50"
                      >
                        {labels.save}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSkipping(null);
                          setSkipWords("");
                        }}
                        className="rounded border border-hairline px-3 py-1 text-[12px] text-muted"
                      >
                        {labels.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSkipping(task.id);
                      setSkipWords(task.skipReason ?? "");
                    }}
                    data-testid={`task-skip-${task.position}`}
                    className="mt-1 pl-8 text-[12px] text-muted underline"
                  >
                    {labels.skip}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      </section>

      <PhotoStrip
        label={labels.photosBefore}
        stage="BEFORE"
        photos={before}
        canWork={canWork && !closed}
        busy={uploading === "BEFORE"}
        labels={labels}
        onPick={onPhoto}
      />
      <PhotoStrip
        label={labels.photosAfter}
        stage="AFTER"
        photos={after}
        canWork={canWork && !closed}
        busy={uploading === "AFTER"}
        labels={labels}
        onPick={onPhoto}
      />

      <section className="mt-5" data-testid="site-signature">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
          {labels.signature}
        </div>

        {signed && (
          <p className="mt-2 text-[13px]" data-testid="signature-done">
            {labels.signedBy}: {signerName || signature?.signerName} ·{" "}
            {signerKind === "ENGINEER" ? labels.signerEngineer : labels.signerSiteContact}
          </p>
        )}

        {canWork && !closed && (
          <div className="mt-2">
            <input
              value={signerName}
              onChange={(event) => setSignerName(event.target.value)}
              placeholder={labels.signerName}
              data-testid="signer-name"
              className="w-full rounded border border-hairline bg-transparent px-2 py-2 text-[14px]"
            />
            <div className="mt-2 flex gap-2 text-[13px]">
              {(["SITE_CONTACT", "ENGINEER"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setSignerKind(kind)}
                  aria-pressed={signerKind === kind}
                  data-testid={`signer-${kind}`}
                  className={`rounded-full border px-3 py-1.5 ${
                    signerKind === kind
                      ? "border-accent text-accent"
                      : "border-hairline text-muted"
                  }`}
                >
                  {kind === "ENGINEER" ? labels.signerEngineer : labels.signerSiteContact}
                </button>
              ))}
            </div>
            <canvas
              ref={canvasRef}
              width={320}
              height={120}
              onPointerDown={strokeStart}
              onPointerMove={strokeMove}
              onPointerUp={strokeEnd}
              onPointerLeave={strokeEnd}
              data-testid="signature-canvas"
              className="mt-2 w-full touch-none rounded-lg border border-dashed border-hairline bg-white"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void onSign()}
                data-testid="signature-save"
                className="rounded bg-accent px-4 py-2 text-[13px] text-background"
              >
                {labels.sign}
              </button>
              <button
                type="button"
                onClick={clearCanvas}
                className="rounded border border-hairline px-4 py-2 text-[13px] text-muted"
              >
                {labels.clear}
              </button>
            </div>
          </div>
        )}
      </section>

      {canWork && (
        <section className="mt-5">
          {closed ? (
            <p className="text-[13px] text-muted" data-testid="order-closed">
              {labels.closed}
            </p>
          ) : (
            <button
              type="button"
              disabled={pending || unanswered.length > 0 || !signed}
              onClick={() => void onClose()}
              data-testid="order-close"
              className="w-full rounded-lg bg-accent px-4 py-3 text-[15px] text-background disabled:opacity-50"
            >
              {pending ? labels.closing : labels.close}
            </button>
          )}
        </section>
      )}

      {error && (
        <p className="mt-3 text-[12px] text-down" data-testid="site-work-error">
          {error}
        </p>
      )}
    </>
  );
}

function PhotoStrip({
  label,
  stage,
  photos,
  canWork,
  busy,
  labels,
  onPick,
}: {
  label: string;
  stage: "BEFORE" | "AFTER";
  photos: SitePhoto[];
  canWork: boolean;
  busy: boolean;
  labels: SiteWorkLabels;
  onPick: (stage: "BEFORE" | "AFTER", file: File) => void | Promise<void>;
}) {
  return (
    <section className="mt-5" data-testid={`site-photos-${stage}`}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className="mt-2 flex gap-2 overflow-x-auto">
        {photos.map((photo) => (
          // Свой маршрут, свой домен; next/image здесь ничего не добавит.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={photo.key}
            src={`/api/v1/work-order-media/${photo.key}`}
            alt=""
            className="h-24 w-24 shrink-0 rounded-md border border-hairline object-cover"
          />
        ))}
        {canWork && (
          <label className="flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-hairline text-center text-[11px] text-muted">
            {busy ? labels.uploading : labels.addPhoto}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              data-testid={`photo-input-${stage}`}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onPick(stage, file);
                event.target.value = "";
              }}
            />
          </label>
        )}
      </div>
    </section>
  );
}
