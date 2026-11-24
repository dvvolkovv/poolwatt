// GET /v1/listing-applications/{id}/documents/{docId} — ТЗ §4, US-01, US-02.
//
// KYB papers are not public files: they are streamed from disk only to the
// company that filed them and to the reviewing operator.
import { forbidden, notFound, sessionUser, unauthorized } from "@/lib/exchange/api";
import { fetchDocument } from "@/lib/exchange/listing-service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const { id, docId } = await params;
  const user = await sessionUser();

  const result = await fetchDocument({ applicationId: id, docId, user });
  if (result.status === "unauthorized") return unauthorized();
  if (result.status === "forbidden") return forbidden();
  if (result.status === "not-found") return notFound("Document not found");

  // The filename is the producer's own wording, so it is quoted and stripped of
  // anything that could break the header.
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
