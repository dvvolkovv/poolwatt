// §27 «Полная карточка: … фото». Байты фотографии.
//
// Файлы лежат вне веб-корня, поэтому решает этот маршрут: карточку видно —
// видно и её фотографии; карточку не видно — «нет такой фотографии».

import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/exchange/api";
import { deletePointPhoto, readPointPhoto } from "@/lib/points/point-photos";
import { isPointStaff, mayViewPointId } from "@/lib/points/point-visibility";
import { prisma } from "@/lib/prisma";

const missing = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id, photoId } = await params;
  const photo = await readPointPhoto(photoId);
  // Фотография чужого пункта по адресу этого — тоже «нет такой».
  if (!photo || photo.pointId !== id) return missing();

  const viewer = await sessionUser();
  if (!(await mayViewPointId(id, viewer?.id ?? null))) return missing();

  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.bytes.length),
      // Фотография станции меняется редко, но карточка может быть закрытой,
      // поэтому кэш только личный.
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id, photoId } = await params;
  const viewer = await sessionUser();
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const row = await prisma.acceptancePoint.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      visibility: true,
      operatorId: true,
      operator: { select: { claimedById: true } },
    },
  });
  if (!row) return missing();
  const staff = await isPointStaff(
    {
      id: row.id,
      status: row.status,
      visibility: row.visibility,
      operatorId: row.operatorId,
      operatorClaimedById: row.operator.claimedById,
    },
    viewer.id,
  );
  if (!staff) return missing();

  const photo = await readPointPhoto(photoId);
  if (!photo || photo.pointId !== id) return missing();

  await deletePointPhoto(photoId);
  return new NextResponse(null, { status: 204 });
}
