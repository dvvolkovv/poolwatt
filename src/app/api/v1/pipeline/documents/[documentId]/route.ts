// GET /v1/pipeline/documents/{id} — §48's documents on a lead.
//
// A lease or a grid agreement belongs to the network that is negotiating it:
// somebody else's document does not exist here.

import { fail, notFound, ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { LeadError, detachLeadDocument, fetchLeadDocument } from "@/lib/crm/lead-service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params;
  const user = await sessionUser();

  const result = await fetchLeadDocument({
    documentId,
    userId: user?.id ?? null,
    isAdmin: user?.role === "ADMIN",
  });
  if (result.status === "not-found") return notFound("Document not found");

  const safeName = result.name.replace(/["\\\r\n]/g, "_");
  return new Response(new Uint8Array(result.bytes), {
    headers: {
      "content-type": result.mime,
      "content-length": String(result.bytes.length),
      "content-disposition": `inline; filename="${safeName}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const user = await sessionUser();
  if (!user) return unauthorized();
  const { documentId } = await params;

  try {
    await detachLeadDocument(documentId, user.id);
    return ok({ removed: documentId });
  } catch (err) {
    if (err instanceof LeadError) return fail("Not found", 404);
    throw err;
  }
}
