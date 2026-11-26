// §28 «Видимость: публичный, только для членов кооператива, только для своих
// клиентов (white label)» — и §29.3: карточку, которая ещё не опубликована,
// видит только её хозяин.
//
// Отказ выглядит как «нет такой карточки», а не как «вам нельзя»: чужая
// карточка не должна подтверждать даже того, что она существует.

import { PointStatus, PointVisibility } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ViewReason = "public" | "coop" | "client" | "staff" | "owner";

export interface PointForVisibility {
  id: string;
  status: PointStatus;
  visibility: PointVisibility;
  operatorId: string;
  operatorClaimedById: string | null;
}

/** Хозяин сети или сотрудник, которому этот пункт в области видимости. */
export async function isPointStaff(
  point: PointForVisibility,
  userId: string,
): Promise<boolean> {
  if (point.operatorClaimedById === userId) return true;
  const employee = await prisma.employee.findFirst({
    where: { operatorId: point.operatorId, userId },
    select: { pointIds: true },
  });
  if (!employee) return false;
  // Пустой список — вся сеть, иначе ровно эти пункты (§47).
  return employee.pointIds.length === 0 || employee.pointIds.includes(point.id);
}

export async function mayViewPoint(
  point: PointForVisibility,
  userId: string | null,
): Promise<ViewReason | null> {
  if (userId && (await isPointStaff(point, userId))) {
    return point.operatorClaimedById === userId ? "owner" : "staff";
  }

  // §29.3 — чернови́к, проверка, тестовое подключение и приостановленный
  // пункт существуют только для своей сети.
  if (point.status !== PointStatus.PUBLISHED) return null;

  switch (point.visibility) {
    case PointVisibility.PUBLIC:
      return "public";

    case PointVisibility.COOP_MEMBERS: {
      if (!userId) return null;
      const member = await prisma.coopMember.count({ where: { userId, status: "ACTIVE" } });
      return member > 0 ? "coop" : null;
    }

    case PointVisibility.OWN_CLIENTS: {
      // «Свой клиент» — тот, кто в этой сети уже платил или чья бронь была
      // исполнена. Карты white label у нас нет (§19 ждёт EMI), поэтому
      // признаком служит настоящий приезд, а не несуществующая карта.
      if (!userId) return null;
      const [paid, booked] = await Promise.all([
        prisma.payment.count({
          where: {
            wallet: { ownerUserId: userId },
            status: "CAPTURED",
            point: { operatorId: point.operatorId },
          },
        }),
        prisma.reservation.count({
          where: {
            userId,
            status: "FULFILLED",
            point: { operatorId: point.operatorId },
          },
        }),
      ]);
      return paid > 0 || booked > 0 ? "client" : null;
    }

    default:
      return null;
  }
}

/** Та же проверка, когда на руках только идентификатор пункта. */
export async function mayViewPointId(
  pointId: string,
  userId: string | null,
): Promise<ViewReason | null> {
  const row = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    select: {
      id: true,
      status: true,
      visibility: true,
      operatorId: true,
      operator: { select: { claimedById: true } },
    },
  });
  if (!row) return null;
  return mayViewPoint(
    {
      id: row.id,
      status: row.status,
      visibility: row.visibility,
      operatorId: row.operatorId,
      operatorClaimedById: row.operator.claimedById,
    },
    userId,
  );
}
