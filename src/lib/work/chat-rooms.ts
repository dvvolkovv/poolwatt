// Ключ комнаты §48 — одна строка, она же имя канала §15.
//
// Комнат три вида, и ни одна не существует в базе отдельной строкой:
// комната — это сеть, бригада или наряд плюс их сообщения. Ключ поэтому
// составной, и собирать его руками в двух местах нельзя — имя канала у
// страницы и у публикатора должно совпадать до буквы, иначе чат молчит и
// никто не знает почему.
//
// Разбор строгий: ключ приходит из адреса, то есть от кого угодно.

import type { ChatRoomKind } from "@prisma/client";

export interface RoomRef {
  kind: ChatRoomKind;
  id: string;
}

const PREFIX: Record<ChatRoomKind, string> = {
  NETWORK: "net",
  CREW: "crew",
  WORK_ORDER: "wo",
};

const KINDS = Object.keys(PREFIX) as ChatRoomKind[];

export function roomKey(ref: RoomRef): string {
  return `${PREFIX[ref.kind]}-${ref.id}`;
}

export function parseRoomKey(key: string): RoomRef | null {
  const dash = key.indexOf("-");
  if (dash <= 0) return null;
  const prefix = key.slice(0, dash);
  const id = key.slice(dash + 1);
  // Идентификатор — cuid: буквы и цифры. Длина ограничена, потому что ключ
  // едет в имя канала §15, а оно проверяется по длине.
  if (!/^[A-Za-z0-9_]{1,60}$/.test(id)) return null;
  const kind = KINDS.find((k) => PREFIX[k] === prefix);
  return kind ? { kind, id } : null;
}

export const chatChannel = (key: string) => `team.${key}`;
