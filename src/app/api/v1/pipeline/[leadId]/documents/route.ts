// POST /v1/pipeline/{leadId}/documents — §48's documents on a lead.

import type { NextRequest } from "next/server";
import { fail, ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { LeadError, attachLeadDocument } from "@/lib/crm/lead-service";
import { LeadDocError } from "@/lib/crm/lead-docs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();
  const { leadId } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Send the document as multipart/form-data", 415);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail('The "file" part is missing', 400);

  try {
    const doc = await attachLeadDocument({
      leadId,
      actorId: user.id,
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return ok({ document: { id: doc.id, name: doc.name, sizeBytes: doc.sizeBytes } }, 201);
  } catch (err) {
    if (err instanceof LeadDocError) return fail(err.message, 400);
    if (err instanceof LeadError) {
      return fail(err.message, /somebody else|No such/.test(err.message) ? 404 : 400);
    }
    throw err;
  }
}
