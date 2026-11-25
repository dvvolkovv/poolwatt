// §44 "Показы и клики по контенту, просмотры видео" — US-44.
//
// The browser writes these: only it knows a block actually reached a person.
// Everything that could make the numbers lie is refused here rather than
// filtered out later — a draft that collects impressions, an event kind
// nobody counts, a point from another network.

import { ContentEventKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "@/lib/exchange/audit";

export class ContentEventError extends Error {}

const KINDS = new Set<string>(Object.values(ContentEventKind));

export interface RecordContentEventInput {
  contentId: string;
  kind: ContentEventKind;
  /** Null for a visitor who is not signed in. */
  userId: string | null;
  /** The point card it was shown on, when it was shown on one. */
  pointId?: string | null;
}

export async function recordContentEvent(
  input: RecordContentEventInput,
  db: Db = prisma,
): Promise<void> {
  if (!KINDS.has(input.kind)) {
    throw new ContentEventError(`No such content event: ${String(input.kind)}`);
  }

  const content = await db.marketingContent.findUnique({
    where: { id: input.contentId },
    select: { id: true, status: true, operatorId: true },
  });
  if (!content) throw new ContentEventError("No such content");
  // §41 — only approved content is ever shown, so only approved content can
  // be seen. Anything else would be a counter the partner can inflate at will.
  if (content.status !== "APPROVED") {
    throw new ContentEventError("That content is not published");
  }

  if (input.pointId) {
    const point = await db.acceptancePoint.findUnique({
      where: { id: input.pointId },
      select: { operatorId: true },
    });
    if (!point || point.operatorId !== content.operatorId) {
      throw new ContentEventError("That point belongs to a different network");
    }
  }

  await db.contentEvent.create({
    data: {
      contentId: content.id,
      kind: input.kind,
      userId: input.userId,
      pointId: input.pointId ?? null,
    },
  });
}
