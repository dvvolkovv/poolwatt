// Чат §48: отправка, системная запись, чтение, список комнат и
// непрочитанное.
//
// Четыре решения, которые стоит знать прежде кода.
//
// 1. Право спрашивается здесь, а не на странице. Служба — единственный вход,
//    и чужая комната отвечает отказом, а не пустым списком: пустой список
//    выглядит как «пока тихо», и человек ждёт ответа, которого не будет.
// 2. Живая доставка не роняет запись. Канал молчит — сообщение всё равно в
//    базе, и страница увидит его при следующей загрузке. Это то же правило,
//    по которому публикация никогда не валит транзакцию (§15).
// 3. Своё сообщение непрочитанным не бывает, поэтому отправка сдвигает
//    отметку «прочитано» сама.
// 4. Комната закрытого наряда остаётся читаемой, но из списка уходит: это
//    история, а не работа. Иначе список инженера за год станет свалкой.

import type { ChatMessage, ChatRoomKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "@/lib/exchange/audit";
import { publish } from "@/lib/exchange/realtime";
import { chatChannel, roomKey, type RoomRef } from "./chat-rooms";
import { readRoomForUser } from "./chat-access";

export class ChatError extends Error {}

export const MAX_CHAT_MESSAGE_LENGTH = 4000;

/** Сколько сообщений отдаёт страница: чат наряда короток, чат сети — нет. */
export const PAGE_SIZE = 200;

export interface ChatMessageView {
  id: string;
  authorKind: "STAFF" | "SYSTEM";
  authorName: string | null;
  mine: boolean;
  body: string;
  at: string;
}

export interface MyRoom {
  key: string;
  kind: ChatRoomKind;
  title: string;
  /** Подпись под названием: сеть бригады, статус наряда. */
  note: string | null;
  unread: number;
  lastAt: string | null;
}

/** Условие выборки по комнате — одно на весь файл, чтобы не разошлось. */
function roomWhere(ref: RoomRef): Prisma.ChatMessageWhereInput {
  if (ref.kind === "NETWORK") return { kind: "NETWORK", operatorId: ref.id };
  if (ref.kind === "CREW") return { kind: "CREW", crewId: ref.id };
  return { kind: "WORK_ORDER", workOrderId: ref.id };
}

/** Ссылки для записи: ровно одна из трёх, как говорит схема. */
function roomLink(ref: RoomRef) {
  if (ref.kind === "NETWORK") return { kind: "NETWORK" as const, operatorId: ref.id };
  if (ref.kind === "CREW") return { kind: "CREW" as const, crewId: ref.id };
  return { kind: "WORK_ORDER" as const, workOrderId: ref.id };
}

export async function postChatMessage(args: {
  key: string;
  userId: string;
  role: string;
  body: string;
}): Promise<ChatMessage> {
  const body = args.body.trim();
  if (body.length === 0) throw new ChatError("A message needs words");
  if (body.length > MAX_CHAT_MESSAGE_LENGTH) throw new ChatError("The message is too long");

  const room = await readRoomForUser(args.key, args.userId, args.role);
  if (!room?.canWrite) throw new ChatError("No such room");

  const message = await prisma.chatMessage.create({
    data: { ...roomLink(room.ref), authorKind: "STAFF", authorId: args.userId, body },
    include: { author: { select: { username: true } } },
  });
  await touchRead(args.key, args.userId, message.createdAt);
  await announce(args.key, message, message.author?.username ?? null);
  return message;
}

/**
 * Факт, о котором говорит сама платформа: назначение, смена статуса. Берёт
 * `Db`, потому что вызывающий может уже сидеть в транзакции.
 */
export async function systemChatMessage(
  db: Db,
  ref: RoomRef,
  body: string,
): Promise<ChatMessage> {
  const message = await db.chatMessage.create({
    data: { ...roomLink(ref), authorKind: "SYSTEM", body: body.trim() },
  });
  await announce(roomKey(ref), message, null);
  return message;
}

export async function readRoomMessages(
  key: string,
  userId: string,
  role: string,
): Promise<ChatMessageView[]> {
  const room = await readRoomForUser(key, userId, role);
  if (!room) throw new ChatError("No such room");
  const rows = await prisma.chatMessage.findMany({
    where: roomWhere(room.ref),
    orderBy: { createdAt: "asc" },
    take: PAGE_SIZE,
    include: { author: { select: { username: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    authorKind: row.authorKind,
    authorName: row.author?.username ?? null,
    mine: row.authorId === userId,
    body: row.body,
    at: row.createdAt.toISOString(),
  }));
}

export async function markRoomSeen(key: string, userId: string, role: string): Promise<void> {
  const room = await readRoomForUser(key, userId, role);
  if (!room) throw new ChatError("No such room");
  await touchRead(key, userId, new Date());
}

/**
 * Комнаты этого человека: его сети, его бригады, его открытые наряды.
 *
 * Роль платформы здесь не спрашивается нарочно: список строится из того, где
 * человек состоит, а не из того, что ему позволено. ADMIN поэтому видит
 * пустой список и заходит в комнаты со страниц — у него нет ни сети, ни
 * бригады, и перечислять ему все комнаты платформы незачем.
 */
export async function listMyRooms(userId: string): Promise<MyRoom[]> {
  const [employments, owned, crews, orders, reads] = await Promise.all([
    prisma.employee.findMany({
      where: { userId },
      select: { operatorId: true, operator: { select: { displayName: true } } },
    }),
    // Владелец сети сотрудником не является — §47 описывает тех, кого он
    // позвал, а не его самого.
    prisma.chargerOperator.findMany({
      where: { claimedById: userId },
      select: { id: true, displayName: true },
    }),
    prisma.crew.findMany({
      where: {
        OR: [
          { members: { some: { employee: { userId } } } },
          { operator: { claimedById: userId } },
        ],
      },
      select: { id: true, name: true, operator: { select: { displayName: true } } },
    }),
    prisma.workOrder.findMany({
      where: {
        closedAt: null,
        OR: [
          { assignee: { userId } },
          { crew: { members: { some: { employee: { userId } } } } },
        ],
      },
      select: { id: true, title: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.chatRead.findMany({ where: { userId }, select: { roomKey: true, seenAt: true } }),
  ]);

  const seen = new Map(reads.map((r) => [r.roomKey, r.seenAt]));
  const refs: { ref: RoomRef; title: string; note: string | null }[] = [];

  const networks = new Map<string, string>();
  for (const e of employments) networks.set(e.operatorId, e.operator.displayName);
  for (const o of owned) networks.set(o.id, o.displayName);
  for (const [id, title] of networks) {
    refs.push({ ref: { kind: "NETWORK", id }, title, note: null });
  }
  for (const c of crews) {
    refs.push({ ref: { kind: "CREW", id: c.id }, title: c.name, note: c.operator.displayName });
  }
  for (const o of orders) {
    refs.push({ ref: { kind: "WORK_ORDER", id: o.id }, title: o.title, note: o.status });
  }

  return Promise.all(
    refs.map(async (row) => {
      const key = roomKey(row.ref);
      const base = roomWhere(row.ref);
      const after = seen.get(key);
      const [unread, last] = await Promise.all([
        prisma.chatMessage.count({
          where: {
            ...base,
            ...(after ? { createdAt: { gt: after } } : {}),
            // Своё непрочитанным не бывает — ни сказанное, ни системное о
            // собственном действии.
            NOT: { authorId: userId },
          },
        }),
        prisma.chatMessage.findFirst({
          where: base,
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);
      return {
        key,
        kind: row.ref.kind,
        title: row.title,
        note: row.note,
        unread,
        lastAt: last?.createdAt.toISOString() ?? null,
      };
    }),
  );
}

/** Одно число для хаба §22: сколько всего меня ждёт. */
export async function unreadTotal(userId: string): Promise<number> {
  const rooms = await listMyRooms(userId);
  return rooms.reduce((sum, room) => sum + room.unread, 0);
}

async function touchRead(key: string, userId: string, at: Date): Promise<void> {
  await prisma.chatRead.upsert({
    where: { userId_roomKey: { userId, roomKey: key } },
    create: { userId, roomKey: key, seenAt: at },
    update: { seenAt: at },
  });
}

async function announce(
  key: string,
  message: ChatMessage,
  authorName: string | null,
): Promise<void> {
  try {
    await publish(chatChannel(key), "chat.message", {
      id: message.id,
      authorKind: message.authorKind,
      authorId: message.authorId,
      authorName,
      body: message.body,
      at: message.createdAt.toISOString(),
    });
  } catch {
    // Пропущенное событие стоит перезагрузки страницы, не записи.
  }
}
