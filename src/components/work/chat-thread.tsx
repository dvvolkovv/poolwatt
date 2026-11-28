"use client";

// §48 «Внутренний чат команды и чат по каждому наряду».
//
// Один компонент на четыре экрана. Живая доставка — канал §15 `team.{ключ}`:
// сообщение дописывается в конец, и страница не перезагружается, потому что
// чат, в котором ответ появляется после перезагрузки, — не чат. Канал молчит
// — экран всё равно показывает отданное сервером, а кнопка дорисовывает своё
// сообщение сама.
//
// `offlineSend` — для телефона: инженер в подвале пишет, запись встаёт в
// очередь §48 и уходит, когда связь вернулась. Там, где очереди нет (монитор
// диспетчера), пропс не передаётся и поведение прежнее.

import { useEffect, useRef, useState, useTransition } from "react";
import { useChannel } from "@/hooks/use-channel";
import { sendChatMessage, seenChatRoom } from "@/app/[locale]/me/chat/actions";

export interface ChatThreadMessage {
  id: string;
  authorKind: string;
  authorName: string | null;
  mine: boolean;
  body: string;
  at: string;
}

export interface ChatThreadLabels {
  title: string;
  placeholder: string;
  send: string;
  sending: string;
  system: string;
  live: string;
  empty: string;
  queued: string;
}

export function ChatThread({
  roomKey,
  messages,
  canWrite,
  labels,
  offlineSend,
  compact = false,
}: {
  roomKey: string;
  messages: ChatThreadMessage[];
  canWrite: boolean;
  labels: ChatThreadLabels;
  /** Телефон: отдать сообщение очереди вместо сервера. */
  offlineSend?: (body: string) => void;
  compact?: boolean;
}) {
  const [thread, setThread] = useState(messages);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [pending, startTransition] = useTransition();
  const seen = useRef(new Set(messages.map((m) => m.id)));
  const tail = useRef<HTMLDivElement | null>(null);

  // Сервер мог отрисовать больше, чем мы знаем (перезагрузка страницы).
  useEffect(() => {
    setThread((current) => {
      const known = new Set(current.map((m) => m.id));
      const added = messages.filter((m) => !known.has(m.id));
      if (added.length === 0) return current;
      for (const m of added) seen.current.add(m.id);
      return [...current, ...added];
    });
  }, [messages]);

  // Открыл комнату — значит прочитал.
  useEffect(() => {
    void seenChatRoom(roomKey);
  }, [roomKey, thread.length]);

  const { connected } = useChannel(`team.${roomKey}`, (event) => {
    if (event.type !== "chat.message") return;
    const incoming = event.data as {
      id?: string;
      authorKind?: string;
      authorName?: string | null;
      body?: string;
      at?: string;
    };
    if (!incoming.id || seen.current.has(incoming.id)) return;
    seen.current.add(incoming.id);
    setThread((current) => [
      ...current,
      {
        id: incoming.id!,
        authorKind: incoming.authorKind ?? "STAFF",
        authorName: incoming.authorName ?? null,
        mine: false,
        body: incoming.body ?? "",
        at: incoming.at ?? new Date().toISOString(),
      },
    ]);
  });

  useEffect(() => {
    tail.current?.scrollIntoView({ block: "nearest" });
  }, [thread.length]);

  function submit() {
    const text = body.trim();
    if (text.length === 0) return;
    setError(null);

    // Связи нет — сообщение не пропадает: оно встаёт в очередь устройства.
    if (offlineSend && typeof navigator !== "undefined" && navigator.onLine === false) {
      offlineSend(text);
      setBody("");
      setQueued(true);
      return;
    }

    startTransition(async () => {
      const result = await sendChatMessage({ key: roomKey, body: text });
      if (!result.ok) {
        // Отказ сети, а не по существу: на телефоне он тоже уходит в очередь.
        if (offlineSend) {
          offlineSend(text);
          setBody("");
          setQueued(true);
          return;
        }
        setError(result.formError);
        return;
      }
      setBody("");
    });
  }

  return (
    <section className={compact ? "mt-4" : "mt-6"} data-testid="chat-room">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted">{labels.title}</h2>
        {connected && (
          <span className="text-[11px] text-muted" data-testid="chat-live">
            {labels.live}
          </span>
        )}
      </div>

      {thread.length === 0 ? (
        <p className="text-[13px] text-muted" data-testid="chat-empty">
          {labels.empty}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="chat-thread">
          {thread.map((message) => (
            <li
              key={message.id}
              data-author={message.authorKind}
              data-mine={message.mine ? "1" : "0"}
              className={
                message.authorKind === "SYSTEM"
                  ? "rounded border border-hairline px-3 py-2 text-[12px] text-muted"
                  : message.mine
                    ? "ml-6 rounded bg-accent/10 px-3 py-2 text-[13px]"
                    : "mr-6 rounded border border-hairline px-3 py-2 text-[13px]"
              }
            >
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
                {message.authorKind === "SYSTEM"
                  ? labels.system
                  : message.authorName
                    ? `@${message.authorName}`
                    : ""}
                {" · "}
                <span className="num">{message.at.slice(0, 16).replace("T", " ")}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap">{message.body}</p>
            </li>
          ))}
          <div ref={tail} />
        </ul>
      )}

      {canWrite && (
        <div className="mt-3">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={compact ? 2 : 3}
            placeholder={labels.placeholder}
            data-testid="chat-input"
            className="w-full rounded border border-hairline bg-transparent px-3 py-2 text-[13px]"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending || body.trim().length === 0}
              onClick={submit}
              data-testid="chat-send"
              className="rounded bg-accent px-4 py-2 text-[13px] text-background disabled:opacity-50"
            >
              {pending ? labels.sending : labels.send}
            </button>
            {queued && (
              <span className="text-[12px] text-muted" data-testid="chat-queued">
                {labels.queued}
              </span>
            )}
          </div>
          {error && (
            <p className="mt-2 text-[12px] text-down" data-testid="chat-error">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
