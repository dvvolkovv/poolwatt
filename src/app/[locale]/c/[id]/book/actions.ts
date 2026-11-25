"use server";

// Booking from the station card — ТЗ §32, US-30.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  cancelReservation,
  extendReservation,
  createReservation,
} from "@/lib/reservations/reservation-service";

export type BookResult =
  | { ok: true; reservationId: string; windowEnd: string }
  | { ok: false; formError: string };

const bookSchema = z.object({
  connectorId: z.string().min(1),
  /** Minutes from now; the form offers a few, not a date picker. */
  inMinutes: z.number().int().min(0).max(24 * 60),
});

export async function book(input: unknown): Promise<BookResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Sign in to book." };

  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const reservation = await createReservation({
      userId: session.user.id,
      connectorId: parsed.data.connectorId,
      eta: new Date(Date.now() + parsed.data.inMinutes * 60_000),
    });
    revalidatePath("/[locale]/c/[id]", "page");
    return {
      ok: true,
      reservationId: reservation.id,
      windowEnd: reservation.windowEnd.toISOString(),
    };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not book." };
  }
}

export async function dropBooking(
  reservationId: string,
): Promise<{ ok: boolean; formError?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  try {
    await cancelReservation(reservationId, session.user.id);
    revalidatePath("/[locale]/me/bookings", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not cancel." };
  }
}

/** §32.4 / US-31 — the driver is running late and pushes the window back. */
export async function extendBooking(
  reservationId: string,
): Promise<{ ok: boolean; formError?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  try {
    await extendReservation({ reservationId, userId: session.user.id });
    revalidatePath("/[locale]/me/bookings", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not extend." };
  }
}
