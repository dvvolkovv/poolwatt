// Очередь записей, сделанных без связи — §48 («наряд закрывается без связи и
// синхронизируется позже») и US-49.
//
// Три решения, которые стоит знать, прежде чем править этот файл.
//
// Первое: ключ идемпотентности придумывается в момент нажатия, а не в момент
// отправки. Иначе два досыла одной записи — два разных ключа, и инженер
// списал запчасть дважды (§15).
//
// Второе: отправка идёт строго по порядку нажатий и останавливается на первой
// записи, которую сеть не взяла. Остаток склада зависит от порядка: две
// выдачи последней платы, пущенные вразнобой, дадут разный ответ.
//
// Третье: запись не исчезает молча никогда. Отказ по существу («на полке
// только два») остаётся на экране со словами сервера, пока инженер его не
// уберёт. Человек, списавший плату в подвале, должен увидеть, что она
// списана — или почему нет.
//
// Background Sync здесь не годится: `SyncManager` в WKWebView нет, а
// оболочка iOS — это WKWebView. Одна механика на обе платформы.

export const QUEUE_KEY = "poolwatt.offlineQueue";

/**
 * Записи §48, которые инженер делает на месте работ.
 *
 * Фотографии сюда не входят сознательно: кадр с камеры 2–5 МБ, и три таких
 * не влезут в `localStorage` — очередь молча потеряла бы запись. Снимок
 * требует связи, и экран говорит это прямо.
 */
export type QueuedKind =
  | "stock.issue"
  | "workorder.task"
  | "workorder.signature"
  | "workorder.status";

export interface QueuedOp {
  /** Он же `Idempotency-Key`: придуман при нажатии, неизменен при досылах. */
  id: string;
  kind: QueuedKind;
  /** Тело запроса как есть — очередь в него не смотрит. */
  body: Record<string, unknown>;
  /** Наряд, к которому относится запись: экран показывает только свои. */
  workOrderId: string;
  /** Что человек увидит в списке неотправленного. */
  label: string;
  at: string;
  state: "pending" | "rejected";
  reason?: string;
}

export type NewOp = Pick<QueuedOp, "kind" | "body" | "workOrderId" | "label">;

/**
 * Что сказал сервер, в терминах очереди, а не HTTP:
 *   done     — 2xx, в том числе повтор по тому же ключу;
 *   offline  — запрос не дошёл или 5xx: попробуем позже;
 *   busy     — 409 «ещё выполняется»: ответ будет, просто не сейчас;
 *   rejected — отказ по существу: 4xx, который не изменится от повтора.
 */
export type SendResult =
  | { outcome: "done" }
  | { outcome: "offline" }
  | { outcome: "busy" }
  | { outcome: "rejected"; reason: string };

export interface FlushReport {
  sent: number;
  pending: number;
  rejected: number;
}

function newId(): string {
  // crypto.randomUUID есть и в WebView обеих оболочек, и в Node 22.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function list(storage: Storage): QueuedOp[] {
  try {
    const raw = storage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (op): op is QueuedOp =>
        typeof op === "object" && op !== null && typeof (op as QueuedOp).id === "string",
    );
  } catch {
    // Приватный режим, переполнение, мусор от старой версии — очередь
    // пустая, но запись дальше работает.
    return [];
  }
}

function save(storage: Storage, ops: QueuedOp[]): void {
  try {
    storage.setItem(QUEUE_KEY, JSON.stringify(ops));
  } catch {
    // Квота. Бросить здесь нечего: вызывающий экран сам покажет, что список
    // не изменился.
  }
}

export function enqueue(storage: Storage, op: NewOp): QueuedOp {
  const queued: QueuedOp = {
    ...op,
    id: newId(),
    at: new Date().toISOString(),
    state: "pending",
  };
  save(storage, [...list(storage), queued]);
  return queued;
}

export function forget(storage: Storage, id: string): void {
  save(
    storage,
    list(storage).filter((op) => op.id !== id),
  );
}

export function pendingCount(storage: Storage): number {
  return list(storage).filter((op) => op.state === "pending").length;
}

/** Записи этого наряда: экран наряда не показывает чужое неотправленное. */
export function listFor(storage: Storage, workOrderId: string): QueuedOp[] {
  return list(storage).filter((op) => op.workOrderId === workOrderId);
}

export async function flush(
  storage: Storage,
  send: (op: QueuedOp) => Promise<SendResult>,
): Promise<FlushReport> {
  let sent = 0;
  for (const op of list(storage)) {
    if (op.state !== "pending") continue;

    const result = await send(op);
    if (result.outcome === "done") {
      forget(storage, op.id);
      sent += 1;
      continue;
    }
    if (result.outcome === "rejected") {
      save(
        storage,
        list(storage).map((row) =>
          row.id === op.id ? { ...row, state: "rejected", reason: result.reason } : row,
        ),
      );
      continue;
    }
    // offline или busy: связь есть не у нас, порядок дороже прогресса.
    break;
  }

  const left = list(storage);
  return {
    sent,
    pending: left.filter((op) => op.state === "pending").length,
    rejected: left.filter((op) => op.state === "rejected").length,
  };
}

/** Разбор настоящего ответа `fetch` в термины очереди. */
export async function classify(response: Response): Promise<SendResult> {
  if (response.ok) return { outcome: "done" };
  if (response.status === 409) return { outcome: "busy" };
  if (response.status >= 500) return { outcome: "offline" };

  let reason = `HTTP ${response.status}`;
  try {
    const body: unknown = await response.json();
    if (
      body &&
      typeof body === "object" &&
      typeof (body as { error?: unknown }).error === "string"
    ) {
      reason = (body as { error: string }).error;
    }
  } catch {
    // Ответ без JSON — остаётся код.
  }
  return { outcome: "rejected", reason };
}
