"use server";

// §51 — the customer's report. Thirty seconds means one server round trip.

import { z } from "zod";
import { auth } from "@/lib/auth";
import { reportProblem } from "@/lib/work/ticket-service";
import { MAX_TICKET_PHOTOS, MAX_TICKET_PHOTO_BYTES } from "@/lib/work/ticket-photos";

const schema = z.object({
  pointId: z.string().min(1),
  connectorId: z.string().min(1).nullable(),
  problemType: z.enum([
    "NO_START",
    "INTERRUPTED",
    "DAMAGED_CABLE",
    "SCREEN_DEAD",
    "BLOCKED",
    "WRONG_PRICE",
    "OTHER",
  ]),
  comment: z.string().trim().max(2000).nullable(),
  // §51.4 — фотографии с места. Приезжают строкой base64: это одно
  // серверное действие, а тридцать секунд §51 не выдержат второго запроса.
  photos: z
    .array(
      z.object({
        filename: z.string().max(200),
        base64: z.string().max(Math.ceil((MAX_TICKET_PHOTO_BYTES * 4) / 3) + 1024),
      }),
    )
    .max(MAX_TICKET_PHOTOS)
    .optional(),
});

export type ReportResult =
  | {
      ok: true;
      ticketId: string;
      opened: boolean;
      /** Сколько фотографий дошло: отказ по файлу не теряет саму заявку. */
      photos: number;
      alternatives: {
        id: string;
        name: string;
        city: string | null;
        distanceM: number | null;
      }[];
    }
  | { ok: false; formError: string };

export async function sendReport(input: unknown): Promise<ReportResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // Signing in is not required to report a broken cable; it only lets the
  // customer follow the ticket afterwards.
  const session = await auth();

  try {
    const result = await reportProblem({
      pointId: parsed.data.pointId,
      connectorId: parsed.data.connectorId,
      reporterId: session?.user?.id ?? null,
      problemType: parsed.data.problemType,
      comment: parsed.data.comment,
      photos: parsed.data.photos?.map((photo) => ({
        filename: photo.filename,
        bytes: Buffer.from(photo.base64, "base64"),
      })),
    });
    return {
      ok: true,
      ticketId: result.ticket.id,
      opened: result.workOrder !== null,
      photos: result.ticket.photos.length,
      alternatives: result.alternatives.map((p) => ({
        id: p.id,
        name: p.name,
        city: p.city,
        distanceM: p.distanceM,
      })),
    };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not send." };
  }
}
