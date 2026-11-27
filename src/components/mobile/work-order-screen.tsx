"use client";

// Наряд на телефоне, §48 и §49, с главным местом US-49 — списанием запчасти,
// которое переживает отсутствие связи.
//
// Одно решение определяет весь файл: **запись всегда идёт через очередь**, и
// только потом очередь пробует её отправить. Онлайн и офлайн ходят одной
// дорогой, поэтому дорога для офлайна не бывает непроверенной — её проверяет
// каждое нажатие, а не только подвал.
//
// Снимок склада на экране — справка на момент загрузки страницы, и подпись
// об этом стоит рядом, как у офлайн-баланса §25. Решает сервер при досыле:
// его «на полке только два» виден как отказ со его собственными словами.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type QueuedKind,
  type NewOp,
  type QueuedOp,
  type SendResult,
  classify,
  enqueue,
  flush,
  forget,
  listFor,
} from "@/lib/mobile/offline-queue";
import type { EngineerStockView } from "@/lib/warehouse/engineer-view";
import { Screen } from "@/components/mobile/screen";
import {
  WorkOrderSiteWork,
  type SitePhoto,
  type SiteSignature,
  type SiteTask,
  type SiteWorkLabels,
} from "@/components/mobile/work-order-site-work";

/**
 * Куда уходит каждая запись очереди. До этой работы таблицы не было: очередь
 * умела один маршрут, а объявленный вид `workorder.status` не отправлял никто
 * и отправлять было некуда.
 */
const ENDPOINTS: Partial<Record<QueuedKind, (workOrderId: string) => string>> = {
  "stock.issue": () => "/api/v1/stock-movements",
  "workorder.task": (id) => `/api/v1/work-orders/${id}/tasks`,
  "workorder.signature": (id) => `/api/v1/work-orders/${id}/signature`,
  "workorder.status": (id) => `/api/v1/work-orders/${id}/status`,
};

export interface WorkOrderScreenLabels {
  title: string;
  where: string;
  howToFind: string;
  fault: string;
  parts: string;
  photos: string;
  issue: string;
  warehouse: string;
  mine: string;
  part: string;
  nothingHere: string;
  onShelf: string;
  qty: string;
  serial: string;
  note: string;
  send: string;
  snapshotAt: string;
  queued: string;
  queuedHint: string;
  sendNow: string;
  sending: string;
  rejected: string;
  dismiss: string;
  offline: string;
}

export interface WorkOrderScreenOrder {
  id: string;
  title: string;
  description: string;
  status: string;
  meta: string;
  where: string;
  howToFind: string | null;
  photos: string[];
  partsNeeded: string[];
}

export function WorkOrderScreen({
  locale,
  order,
  stock,
  site,
  labels,
  siteLabels,
}: {
  locale: string;
  order: WorkOrderScreenOrder;
  stock: EngineerStockView;
  /** §48 — чек-лист, снимки и подпись этого наряда. */
  site: { tasks: SiteTask[]; photos: SitePhoto[]; signature: SiteSignature | null; canWork: boolean };
  labels: WorkOrderScreenLabels;
  siteLabels: SiteWorkLabels;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  const [busy, setBusy] = useState(false);

  const [warehouseId, setWarehouseId] = useState(stock.warehouses[0]?.id ?? "");
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState("1");
  const [serialNo, setSerialNo] = useState("");
  const [note, setNote] = useState("");

  const warehouse = stock.warehouses.find((w) => w.id === warehouseId) ?? null;
  const part = warehouse?.items.find((i) => i.partId === partId) ?? null;

  const store = (): Storage | null =>
    typeof window === "undefined" ? null : window.localStorage;

  const refreshQueue = useCallback(() => {
    const s = store();
    setQueue(s ? listFor(s, order.id) : []);
  }, [order.id]);

  const send = useCallback(async (op: QueuedOp): Promise<SendResult> => {
    const url = ENDPOINTS[op.kind]?.(op.workOrderId);
    if (!url) return { outcome: "rejected", reason: `Unsupported operation ${op.kind}` };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": op.id },
        body: JSON.stringify(op.body),
      });
      return await classify(res);
    } catch {
      // `fetch` бросает только когда запрос не ушёл: это и есть офлайн.
      return { outcome: "offline" };
    }
  }, []);

  const drain = useCallback(async () => {
    const s = store();
    if (!s) return;
    setBusy(true);
    try {
      const report = await flush(s, send);
      refreshQueue();
      // Остаток на экране обновится только с сервера: снимок в пропсах
      // пришёл до списания.
      if (report.sent > 0) router.refresh();
    } finally {
      setBusy(false);
    }
  }, [refreshQueue, router, send]);

  useEffect(() => {
    refreshQueue();
    void drain();
    const onOnline = () => void drain();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // drain меняется только вместе с нарядом, но ссылка новая на каждый
    // рендер: эффект нужен один раз на экран.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  async function onIssue(event: React.FormEvent) {
    event.preventDefault();
    const s = store();
    if (!s || !partId || !warehouseId) return;

    const amount = Number.parseInt(qty, 10);
    if (!Number.isInteger(amount) || amount <= 0) return;

    enqueue(s, {
      kind: "stock.issue",
      workOrderId: order.id,
      label: `${part?.name ?? partId} × ${amount}`,
      body: {
        kind: "ISSUE",
        partId,
        warehouseId,
        qty: amount,
        workOrderId: order.id,
        ...(serialNo.trim() ? { serialNo: serialNo.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    });
    refreshQueue();
    setPartId("");
    setQty("1");
    setSerialNo("");
    setNote("");
    await drain();
  }

  /**
   * Поставить запись в очередь и попробовать отправить. Один путь на все
   * записи §48: иначе отметка пункта ушла бы мимо очереди и потерялась в
   * подвале.
   */
  const enqueueOp = useCallback(
    async (op: NewOp) => {
      const s = store();
      if (!s) return;
      enqueue(s, op);
      refreshQueue();
      await drain();
    },
    [drain, refreshQueue],
  );

  function onDismiss(id: string) {
    const s = store();
    if (!s) return;
    forget(s, id);
    refreshQueue();
  }

  return (
    <Screen title={labels.title} back={`/${locale}/app/work-orders`}>
      <h2 className="mt-2 text-[18px] font-semibold">{order.title}</h2>
      <p className="mt-0.5 text-[12px] text-muted">{order.meta}</p>

      {order.where && (
        <Field label={labels.where}>
          <p className="text-[14px]">{order.where}</p>
        </Field>
      )}
      {order.howToFind && (
        <Field label={labels.howToFind}>
          <p className="text-[14px]">{order.howToFind}</p>
        </Field>
      )}
      <Field label={labels.fault}>
        <p className="whitespace-pre-wrap text-[14px]">{order.description}</p>
      </Field>
      {order.partsNeeded.length > 0 && (
        <Field label={labels.parts}>
          <p className="text-[14px]">{order.partsNeeded.join(", ")}</p>
        </Field>
      )}
      {order.photos.length > 0 && (
        <Field label={labels.photos}>
          <div className="flex gap-2 overflow-x-auto">
            {order.photos.map((src) => (
              // Фотографии клиента §51 приходят внешними адресами; next/image
              // для них потребовал бы белого списка доменов.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt=""
                className="h-24 w-24 rounded-md border border-hairline object-cover"
              />
            ))}
          </div>
        </Field>
      )}

      <WorkOrderSiteWork
        workOrderId={order.id}
        status={order.status}
        tasks={site.tasks}
        photos={site.photos}
        signature={site.signature}
        canWork={site.canWork}
        labels={siteLabels}
        enqueueOp={enqueueOp}
        refresh={() => router.refresh()}
      />

      {queue.length > 0 && (
        <section
          data-testid="offline-queue"
          className="mt-5 rounded-lg border border-hairline bg-card p-3"
        >
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
            {labels.queued}
          </div>
          <ul className="mt-2 divide-y divide-hairline">
            {queue.map((op) => (
              <li key={op.id} data-queue-state={op.state} className="py-2 text-[13px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span>{op.label}</span>
                  <span className="num text-[11px] text-muted">{op.at.slice(11, 16)}</span>
                </div>
                {op.state === "rejected" && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-[12px] text-accent">
                      {labels.rejected}: {op.reason}
                    </span>
                    <button
                      type="button"
                      data-testid="queue-dismiss"
                      onClick={() => onDismiss(op.id)}
                      className="rounded border border-hairline px-2 py-0.5 text-[12px] text-muted"
                    >
                      {labels.dismiss}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted">{labels.queuedHint}</p>
          <button
            type="button"
            data-testid="queue-send-now"
            onClick={() => void drain()}
            disabled={busy}
            className="mt-2 w-full rounded-md border border-hairline px-3 py-2 text-[14px] disabled:opacity-50"
          >
            {busy ? labels.sending : labels.sendNow}
          </button>
        </section>
      )}

      <form onSubmit={onIssue} className="mt-5 rounded-lg border border-hairline bg-card p-3">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
          {labels.issue}
        </div>

        <label className="mt-3 block text-[12px] text-muted">
          {labels.warehouse}
          <select
            data-testid="issue-warehouse"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setPartId("");
            }}
            className="mt-1 w-full rounded-md border border-hairline bg-bg px-2 py-2 text-[15px] text-foreground"
          >
            {stock.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.mine ? ` — ${labels.mine}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-[12px] text-muted">
          {labels.part}
          <select
            data-testid="issue-part"
            value={partId}
            onChange={(e) => setPartId(e.target.value)}
            className="mt-1 w-full rounded-md border border-hairline bg-bg px-2 py-2 text-[15px] text-foreground"
          >
            <option value="">—</option>
            {(warehouse?.items ?? []).map((i) => (
              <option key={i.partId} value={i.partId}>
                {i.name} · {i.qty} {labels.onShelf}
              </option>
            ))}
          </select>
        </label>
        {warehouse && warehouse.items.length === 0 && (
          <p className="mt-1 text-[12px] text-muted">{labels.nothingHere}</p>
        )}

        <label className="mt-3 block text-[12px] text-muted">
          {labels.qty}
          <input
            data-testid="issue-qty"
            type="number"
            inputMode="numeric"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="num mt-1 w-full rounded-md border border-hairline bg-bg px-2 py-2 text-[15px] text-foreground"
          />
        </label>

        {part?.serialTracked && (
          <label className="mt-3 block text-[12px] text-muted">
            {labels.serial}
            <input
              data-testid="issue-serial"
              value={serialNo}
              onChange={(e) => setSerialNo(e.target.value)}
              className="mt-1 w-full rounded-md border border-hairline bg-bg px-2 py-2 text-[15px] text-foreground"
            />
          </label>
        )}

        <label className="mt-3 block text-[12px] text-muted">
          {labels.note}
          <input
            data-testid="issue-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-md border border-hairline bg-bg px-2 py-2 text-[15px] text-foreground"
          />
        </label>

        <button
          type="submit"
          data-testid="issue-send"
          disabled={!partId}
          className="mt-4 w-full rounded-md bg-accent px-3 py-3 text-[15px] font-semibold text-bg disabled:opacity-50"
        >
          {labels.send}
        </button>
        <p className="mt-2 text-[12px] text-muted">{labels.snapshotAt}</p>
      </form>

      <p className="mt-4 text-[12px] text-muted">
        <Link href={`/${locale}/me/work-orders/${order.id}`} prefetch={false} className="underline">
          {labels.title}
        </Link>
      </p>
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
