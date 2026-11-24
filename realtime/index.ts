#!/usr/bin/env tsx
// The realtime process — ТЗ §15 "WebSocket-каналы".
//
// Next.js owns HTTP; WebSocket upgrades are not something the App Router
// serves, so the sockets live here and nginx routes /ws to this port. The
// process is a fan-out and nothing else: it holds no business logic, writes
// nothing, and reads only the Redis bus that the web process publishes to.
//
// Standalone Node entrypoint, so both .env files are loaded explicitly
// (see CLAUDE.md "dotenv + .env.local").

import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

import { createServer } from "node:http";
import Redis from "ioredis";
import { WebSocketServer, type WebSocket } from "ws";
import {
  CHANNEL_PREFIX,
  isPublicChannel,
  ticketAllows,
  verifyTicket,
  type TicketClaims,
} from "@/lib/exchange/realtime";

const PORT = Number(process.env.REALTIME_PORT ?? 3101);
const HOST = process.env.REALTIME_HOST ?? "127.0.0.1";
const PING_MS = 30_000;

function log(...args: unknown[]) {
  console.log("[realtime]", ...args);
}

/** One connected browser: which channels it asked for and may hear. */
interface Client {
  socket: WebSocket;
  claims: TicketClaims;
  channels: Set<string>;
  alive: boolean;
}

const clients = new Set<Client>();

function deliver(channel: string, payload: string) {
  for (const client of clients) {
    if (client.channels.has(channel) && client.socket.readyState === client.socket.OPEN) {
      client.socket.send(payload);
    }
  }
}

function send(socket: WebSocket, type: string, data: Record<string, unknown>) {
  socket.send(JSON.stringify({ type, at: new Date().toISOString(), data }));
}

/**
 * A client may subscribe to a public channel freely and to a private one only
 * if its ticket names it. The ticket is minted by the web process, which is
 * the only place that knows who owns which wallet and which asset.
 */
function subscribe(client: Client, channel: string): { ok: boolean; reason?: string } {
  if (!isPublicChannel(channel) && !ticketAllows(client.claims, channel)) {
    return { ok: false, reason: "not allowed on this ticket" };
  }
  client.channels.add(channel);
  return { ok: true };
}

function handleMessage(client: Client, raw: string) {
  let message: { action?: unknown; channel?: unknown };
  try {
    message = JSON.parse(raw);
  } catch {
    send(client.socket, "error", { error: "message is not JSON" });
    return;
  }

  const channel = typeof message.channel === "string" ? message.channel : "";
  if (message.action === "subscribe") {
    const result = subscribe(client, channel);
    if (result.ok) send(client.socket, "subscribed", { channel });
    else send(client.socket, "error", { channel, error: result.reason });
    return;
  }
  if (message.action === "unsubscribe") {
    client.channels.delete(channel);
    send(client.socket, "unsubscribed", { channel });
    return;
  }
  if (message.action === "ping") {
    send(client.socket, "pong", {});
    return;
  }
  send(client.socket, "error", { error: "unknown action" });
}

function main() {
  const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });

  subscriber.on("error", (err) => console.error("[realtime] redis:", err.message));
  subscriber.psubscribe(`${CHANNEL_PREFIX}*`, (err, count) => {
    if (err) console.error("[realtime] psubscribe failed:", err.message);
    else log(`subscribed to ${CHANNEL_PREFIX}* (${count} pattern)`);
  });
  subscriber.on("pmessage", (_pattern, key, payload) => {
    deliver(key.slice(CHANNEL_PREFIX.length), payload);
  });

  // A plain HTTP server so the health check and the upgrade share a port.
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, clients: clients.size }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/ws", "http://localhost");
    const ticket = url.searchParams.get("ticket") ?? "";
    const claims = ticket ? verifyTicket(ticket) : null;
    if (!claims) {
      // 4401: application-level "unauthorized", so the page can tell this
      // apart from a dropped connection and ask for a fresh ticket.
      socket.close(4401, "invalid or expired ticket");
      return;
    }

    const client: Client = { socket, claims, channels: new Set(), alive: true };
    clients.add(client);
    send(socket, "ready", { channels: claims.channels });

    socket.on("message", (data) => handleMessage(client, data.toString()));
    socket.on("pong", () => {
      client.alive = true;
    });
    socket.on("close", () => clients.delete(client));
    socket.on("error", () => clients.delete(client));
  });

  // Drop sockets that stopped answering, or a phone that went into a tunnel
  // keeps a slot forever.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, PING_MS);
  heartbeat.unref();

  server.listen(PORT, HOST, () => log(`listening on ws://${HOST}:${PORT}/ws`));
}

main();
