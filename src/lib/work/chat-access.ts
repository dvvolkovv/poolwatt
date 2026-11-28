// Кто в комнате §48 — одно место, и для наряда оно уже написано.
//
// Комната наряда не отвечает сама: она зовёт `readWorkOrderForUser`. Второй
// ответ на вопрос «чей это наряд» однажды разойдётся с первым — и разойдётся
// в сторону «да», как было с `tickets.write` до N-1 и `warehouse.write` до
// US-49.
//
// Права «чат» в §47 нет, и выдумывать его нельзя. Поэтому комната сети —
// любая роль этой сети: бухгалтер и маркетолог — тоже команда. Комната
// бригады — только её участники и владелец сети: чужая бригада не твой
// разговор, а диспетчеру, которому надо сказать слово о работе, есть где —
// чат наряда и комната сети.

import { prisma } from "@/lib/prisma";
import { readEmployee } from "@/lib/staff/staff-service";
import { parseRoomKey, type RoomRef } from "./chat-rooms";
import { readWorkOrderForUser } from "./work-order-access";

export interface RoomView {
  key: string;
  ref: RoomRef;
  title: string;
  /**
   * Читать можно всегда, когда комната вернулась. Писать — тоже: сказать
   * инженеру «ворота с обратной стороны» не значит работать в наряде. Поле
   * остаётся отдельным, потому что комната «только на чтение» однажды
   * понадобится (скажем, закрытая переписка завершённого наряда).
   */
  canWrite: boolean;
}

/** Комната, если этот человек в ней, иначе null — чужой комнаты не существует. */
export async function readRoomForUser(
  key: string,
  userId: string,
  role: string,
): Promise<RoomView | null> {
  const ref = parseRoomKey(key);
  if (!ref) return null;

  if (ref.kind === "WORK_ORDER") {
    const seen = await readWorkOrderForUser(ref.id, userId, role);
    if (!seen) return null;
    return { key, ref, title: seen.order.title, canWrite: true };
  }

  if (ref.kind === "NETWORK") {
    const operator = await prisma.chargerOperator.findUnique({
      where: { id: ref.id },
      select: { id: true, displayName: true, claimedById: true },
    });
    if (!operator) return null;
    if (role === "ADMIN" || operator.claimedById === userId) {
      return { key, ref, title: operator.displayName, canWrite: true };
    }
    const employee = await readEmployee(operator.id, userId);
    if (!employee) return null;
    return { key, ref, title: operator.displayName, canWrite: true };
  }

  const crew = await prisma.crew.findUnique({
    where: { id: ref.id },
    select: {
      id: true,
      name: true,
      operatorId: true,
      operator: { select: { claimedById: true } },
      members: { select: { employee: { select: { userId: true } } } },
    },
  });
  if (!crew) return null;
  if (role === "ADMIN" || crew.operator.claimedById === userId) {
    return { key, ref, title: crew.name, canWrite: true };
  }
  if (crew.members.some((m) => m.employee.userId === userId)) {
    return { key, ref, title: crew.name, canWrite: true };
  }
  return null;
}
