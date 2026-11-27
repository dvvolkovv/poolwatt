"use client";

// §51.5 «клиент видит статус заявки и переписывается с поддержкой в чате».
//
// Один компонент на четыре страницы. Живая доставка — канал §15
// `ticket.{id}`: новое сообщение дописывается в конец, и страница не
// перезагружается, потому что чат, в котором ответ появляется после
// перезагрузки, — не чат. Канал молчит — страница всё равно показывает то,
// что отдал сервер, и кнопка «Отправить» дорисовывает своё сообщение сама.

import { useEffect, useRef, useState, useTransition } from "react";
import { useChannel } from "@/hooks/use-channel";
import {
  markTicketResolved,
  sendTicketMessage,
} from "@/app/[locale]/me/tickets/actions";

export interface ThreadMessage {
  id: string;
  authorKind: string;
  authorName: string | null;
  body: string;
  at: string;
}

export interface TicketThreadLabels {
  conversation: string;
  placeholder: string;
  send: string;
  sending: string;
  resolve: string;
  closed: string;
  system: string;
  customer: string;
  support: string;
  live: string;
}

export function TicketThread({
  ticketId,
  messages,
  canWrite,
  canResolve,
  closed,
  labels,
}: {
  ticketId: string;
  messages: ThreadMessage[];
  canWrite: boolean;
  canResolve: boolean;
  closed: boolean;
  labels: TicketThreadLabels;
}) {
  const [thread, setThread] = useState(messages);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const seen = useRef(new Set(messages.map((m) => m.id)));

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

  const { connected } = useChannel(`ticket.${ticketId}`, (event) => {
    if (event.type !== "ticket.message") return;
    const incoming = event.data as {
      id?: string;
      authorKind?: string;
      body?: string;
      at?: string;
    };
    if (!incoming.id || seen.current.has(incoming.id)) return;
    seen.current.add(incoming.id);
    setThread((current) => [
      ...current,
      {
        id: incoming.id!,
        authorKind: incoming.authorKind ?? "SUPPORT",
        authorName: null,
        body: incoming.body ?? "",
        at: incoming.at ?? new Date().toISOString(),
      },
    ]);
  });

  function submit(resolve: boolean) {
    const text = body.trim();
    if (text.length === 0) return;
    setError(null);
    startTransition(async () => {
      const result = resolve
        ? await markTicketResolved({ ticketId, body: text })
        : await sendTicketMessage({ ticketId, body: text });
      if (!result.ok) {
        setError(result.formError);
        return;
      }
      setBody("");
    });
  }

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.conversation}
        </h2>
        {connected && (
          <span className="text-[11px] text-muted" data-testid="ticket-live">
            {labels.live}
          </span>
        )}
      </div>

      <ul className="space-y-2" data-testid="ticket-thread">
        {thread.map((message) => (
          <li
            key={message.id}
            data-author={message.authorKind}
            className={
              message.authorKind === "SYSTEM"
                ? "rounded border border-hairline px-3 py-2 text-[12px] text-muted"
                : message.authorKind === "SUPPORT"
                  ? "rounded bg-accent/10 px-3 py-2 text-[13px]"
                  : "rounded border border-hairline px-3 py-2 text-[13px]"
            }
          >
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
              {message.authorKind === "SYSTEM"
                ? labels.system
                : message.authorKind === "SUPPORT"
                  ? labels.support
                  : labels.customer}
              {message.authorName && <> · @{message.authorName}</>}
              {" · "}
              <span className="num">{message.at.slice(0, 16).replace("T", " ")}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap">{message.body}</p>
          </li>
        ))}
      </ul>

      {closed ? (
        <p className="mt-3 text-[13px] text-muted" data-testid="ticket-closed">
          {labels.closed}
        </p>
      ) : canWrite ? (
        <div className="mt-3">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            placeholder={labels.placeholder}
            data-testid="ticket-reply"
            className="w-full rounded border border-hairline bg-transparent px-3 py-2 text-[13px]"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || body.trim().length === 0}
              onClick={() => submit(false)}
              data-testid="ticket-send"
              className="rounded bg-accent px-4 py-2 text-[13px] text-background disabled:opacity-50"
            >
              {pending ? labels.sending : labels.send}
            </button>
            {canResolve && (
              <button
                type="button"
                disabled={pending || body.trim().length === 0}
                onClick={() => submit(true)}
                data-testid="ticket-resolve"
                className="rounded border border-accent px-4 py-2 text-[13px] text-accent disabled:opacity-50"
              >
                {labels.resolve}
              </button>
            )}
          </div>
          {error && (
            <p className="mt-2 text-[12px] text-down" data-testid="ticket-error">
              {error}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
