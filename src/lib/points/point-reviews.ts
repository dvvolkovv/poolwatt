// §27 «Полная карточка: … отзывы».
//
// Право на отзыв есть у того, кто здесь был: завершённый сеанс зарядки или
// исполненная бронь. Причина простая — отзыв, не привязанный ни к одному
// приезду, это способ испортить чужую карточку, за которую партнёр отвечает,
// а приезд у нас уже записан в базе.
//
// Один отзыв на человека и пункт; свой можно переписать. Модерации отзывов в
// ТЗ нет, и придумывать её мы не будем: удалять чужой отзыв некому.

import { ChargeSessionStatus, ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Длиннее этого отзыв никто не читает. */
export const MAX_REVIEW_CHARS = 1000;

export type ReviewResult =
  | { ok: true; reviewId: string }
  | { ok: false; reason: "no_visit" | "bad_rating" | "no_point" };

export async function mayReview(userId: string, pointId: string): Promise<boolean> {
  const charged = await prisma.chargeSession.findFirst({
    where: { userId, pointId, status: ChargeSessionStatus.COMPLETED },
    select: { id: true },
  });
  if (charged) return true;

  const booked = await prisma.reservation.findFirst({
    where: { userId, pointId, status: ReservationStatus.FULFILLED },
    select: { id: true },
  });
  return booked !== null;
}

export async function saveReview(args: {
  userId: string;
  pointId: string;
  rating: number;
  text: string | null;
}): Promise<ReviewResult> {
  if (!Number.isInteger(args.rating) || args.rating < 1 || args.rating > 5) {
    return { ok: false, reason: "bad_rating" };
  }

  const point = await prisma.acceptancePoint.findUnique({
    where: { id: args.pointId },
    select: { id: true },
  });
  if (!point) return { ok: false, reason: "no_point" };

  if (!(await mayReview(args.userId, args.pointId))) {
    return { ok: false, reason: "no_visit" };
  }

  const text = args.text?.trim() ? args.text.trim().slice(0, MAX_REVIEW_CHARS) : null;
  const row = await prisma.pointReview.upsert({
    where: { pointId_userId: { pointId: args.pointId, userId: args.userId } },
    update: { rating: args.rating, text },
    create: { pointId: args.pointId, userId: args.userId, rating: args.rating, text },
  });
  return { ok: true, reviewId: row.id };
}

export interface ReviewsView {
  average: number | null;
  count: number;
  rows: { id: string; author: string; rating: number; text: string | null; at: string }[];
}

export async function readReviews(pointId: string, take = 20): Promise<ReviewsView> {
  const [aggregate, rows] = await Promise.all([
    prisma.pointReview.aggregate({
      where: { pointId },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    prisma.pointReview.findMany({
      where: { pointId },
      orderBy: { createdAt: "desc" },
      take,
      include: { user: { select: { name: true, username: true } } },
    }),
  ]);

  return {
    // Пункт без отзывов не «ноль звёзд», а «оценок нет».
    average: aggregate._count._all > 0 ? (aggregate._avg.rating ?? null) : null,
    count: aggregate._count._all,
    rows: rows.map((r) => ({
      id: r.id,
      author: r.user.name ?? r.user.username,
      rating: r.rating,
      text: r.text,
      at: r.createdAt.toISOString(),
    })),
  };
}

export async function readMyReview(
  userId: string,
  pointId: string,
): Promise<{ rating: number; text: string | null } | null> {
  const row = await prisma.pointReview.findUnique({
    where: { pointId_userId: { pointId, userId } },
    select: { rating: true, text: true },
  });
  return row ?? null;
}
