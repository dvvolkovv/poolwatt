"use client";

// Subscribe a page to a live channel — ТЗ §15, US-17.
//
// The flow is: ask the app for a ticket (a WebSocket cannot carry an
// Authorization header), open the socket, subscribe, and on every event call
// the handler. A closed socket is retried with a growing pause, and a page
// whose socket never opens is not broken: it keeps the data the server
// rendered, which is why `connected` is reported rather than thrown.

import { useEffect, useRef, useState } from "react";

export interface ChannelEvent {
  channel: string;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export function useChannel(
  channel: string | null,
  onEvent: (event: ChannelEvent) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  // The handler usually closes over state; keeping it in a ref means a new
  // render does not tear the socket down and build it again. Written in an
  // effect, because a ref must not be touched during render.
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!channel) return;

    let socket: WebSocket | null = null;
    let retryMs = FIRST_RETRY_MS;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    async function connect() {
      if (stopped) return;
      try {
        const response = await fetch("/api/v1/realtime/ticket", { method: "POST" });
        if (!response.ok) throw new Error(`ticket ${response.status}`);
        const { ticket } = (await response.json()) as { ticket: string };

        const scheme = window.location.protocol === "https:" ? "wss" : "ws";
        socket = new WebSocket(`${scheme}://${window.location.host}/ws?ticket=${ticket}`);

        socket.onopen = () => {
          setConnected(true);
          retryMs = FIRST_RETRY_MS;
          socket?.send(JSON.stringify({ action: "subscribe", channel }));
        };
        socket.onmessage = (message) => {
          try {
            const event = JSON.parse(message.data as string) as ChannelEvent;
            if (event.channel === channel) handler.current(event);
          } catch {
            // A message we cannot read is not worth breaking the page over.
          }
        };
        socket.onclose = () => {
          setConnected(false);
          scheduleRetry();
        };
        socket.onerror = () => socket?.close();
      } catch {
        scheduleRetry();
      }
    }

    function scheduleRetry() {
      if (stopped || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
        void connect();
      }, retryMs);
    }

    void connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [channel]);

  return { connected };
}
