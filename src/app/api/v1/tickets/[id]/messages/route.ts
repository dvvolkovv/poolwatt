// POST /v1/tickets/{id}/messages — реплика в разговор §51.5.
// GET — сам разговор, тем же правом.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, notFound, ok, unauthorized, parseBody, sessionUser } from "@/lib/exchange/api";
import { readTicketForUser } from "@/lib/work/ticket-access";
import {
  MAX_MESSAGE_LENGTH,
  TicketConversationError,
  postTicketMessage,
} from "@/lib/work/ticket-conversation";
import { readThread } from "@/lib/work/ticket-view";

const schema = z.object({ body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await sessionUser();
  if (!user) return unauthorized();
  const seen = await readTicketForUser(id, user.id, user.role);
  if (!seen) return notFound();
  return ok({ messages: await readThread(id) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(request, schema);
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;

  const seen = await readTicketForUser(id, user.id, user.role);
  // Нет права писать — для вызывающего это то же, что нет заявки.
  if (!seen?.canWrite) return notFound();

  try {
    const message = await postTicketMessage({
      ticketId: id,
      authorKind: seen.authorKind,
      authorId: user.id,
      body: body.body,
    });
    return ok({ message: { id: message.id, at: message.createdAt.toISOString() } }, 201);
  } catch (err) {
    if (err instanceof TicketConversationError) return fail(err.message, 409);
    throw err;
  }
}
