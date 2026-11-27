// GET /v1/work-order-media/{key} — байты снимка «до/после» или подписи §48.
//
// Право одно и то же, что на сам наряд: кому виден наряд, тому видны и его
// снимки. Отдельного права у файла нет — иначе их стало бы два, и они
// разошлись бы.

import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/exchange/api";
import { readWorkOrderForUser } from "@/lib/work/work-order-access";
import { readWorkOrderMedia } from "@/lib/work/work-order-media";

const missing = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const viewer = await sessionUser();
  if (!viewer) return missing();

  const media = await readWorkOrderMedia(key);
  if (!media) return missing();

  const seen = await readWorkOrderForUser(media.workOrderId, viewer.id, viewer.role);
  if (!seen) return missing();

  return new NextResponse(new Uint8Array(media.bytes), {
    headers: {
      "Content-Type": media.contentType,
      "Content-Length": String(media.bytes.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
