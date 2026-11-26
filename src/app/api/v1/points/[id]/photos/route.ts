// §28 «Адрес и карта: … фото до 10 шт.» — загрузка и список.
//
// Загружает только сеть пункта: хозяин или сотрудник, которому этот пункт в
// области видимости (§47). Заявленный тип файла не принимается на слово —
// тип берётся из первых байтов.

import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/exchange/api";
import {
  MAX_PHOTOS,
  PhotoError,
  listPointPhotos,
  savePointPhoto,
} from "@/lib/points/point-photos";
import { isPointStaff, mayViewPointId } from "@/lib/points/point-visibility";
import { prisma } from "@/lib/prisma";

async function staffOf(pointId: string, userId: string): Promise<boolean> {
  const row = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    select: {
      id: true,
      status: true,
      visibility: true,
      operatorId: true,
      operator: { select: { claimedById: true } },
    },
  });
  if (!row) return false;
  return isPointStaff(
    {
      id: row.id,
      status: row.status,
      visibility: row.visibility,
      operatorId: row.operatorId,
      operatorClaimedById: row.operator.claimedById,
    },
    userId,
  );
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await sessionUser();

  // Список фотографий — это часть карточки, и прячется он вместе с ней.
  if (!(await mayViewPointId(id, viewer?.id ?? null))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const photos = await listPointPhotos(id);
  return NextResponse.json({
    photos: photos.map((p) => ({
      id: p.id,
      url: `/api/v1/points/${id}/photos/${p.id}`,
      contentType: p.contentType,
      sizeBytes: p.sizeBytes,
      position: p.position,
    })),
    max: MAX_PHOTOS,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await sessionUser();
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  // Чужому пункту отвечаем «нет такого», а не «вам нельзя».
  if (!(await staffOf(id, viewer.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Field `file` is required" }, { status: 422 });
  }

  try {
    const photo = await savePointPhoto({
      pointId: id,
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(
      { photoId: photo.id, url: `/api/v1/points/${id}/photos/${photo.id}` },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof PhotoError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}
