// GET /v1/marketing/media/{assetId} — ТЗ §41, US-40.
//
// Banners and videos are not in /public: a file is served only once its
// content is approved and inside its own schedule, and before that only to
// the partner previewing it and the operator moderating it.

import { notFound, sessionUser } from "@/lib/exchange/api";
import { fetchAsset } from "@/lib/marketing/content-service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  const user = await sessionUser();

  const result = await fetchAsset({
    assetId,
    userId: user?.id ?? null,
    isAdmin: user?.role === "ADMIN",
  });
  if (result.status === "not-found") return notFound("No such file");

  return new Response(new Uint8Array(result.bytes), {
    headers: {
      "content-type": result.mime,
      "content-length": String(result.bytes.length),
      "content-disposition": "inline",
      // Public content may sit in a shared cache for a minute; a preview must
      // not leave this browser at all.
      "cache-control": result.isPublic ? "public, max-age=60" : "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
