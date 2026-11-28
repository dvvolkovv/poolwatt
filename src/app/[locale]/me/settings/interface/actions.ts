"use server";

// Настройки интерфейса кабинета. Две вещи и обе на человеке, а не на
// устройстве: цвет контура плиток и порядок, в котором он их разложил.
//
// Ни то, ни другое не двигает денег и энергии, поэтому ключа идемпотентности
// §15 здесь нет: повтор просто перезапишет то же самое.

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTileAccent } from "@/lib/cabinet/accents";
import { readCabinetContext } from "@/lib/cabinet/context";
import { sanitizeTileOrder, tilesFor } from "@/lib/cabinet/tiles";

export async function saveInterfacePrefs(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const userId = session.user.id;

  const accent = parseTileAccent(formData.get("accent"));

  // Порядок приходит строкой ключей через запятую. Разрешены только плитки,
  // которые у этого человека есть: чужую в свой порядок не положить.
  const ctx = await readCabinetContext(userId, session.user.role === "ADMIN");
  const allowed = tilesFor("root", ctx.caps).map((tile) => tile.key);
  const raw = String(formData.get("order") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const order = sanitizeTileOrder(raw, allowed);

  await prisma.user.update({
    where: { id: userId },
    data: {
      tileAccent: accent,
      // Пустой порядок — это не «пусто», а «как в каталоге».
      tileOrder: order.length > 0 ? order : Prisma.DbNull,
    },
  });

  revalidatePath(`/[locale]/me`, "page");
  revalidatePath(`/[locale]/me/settings/interface`, "page");
}

/** Вернуть порядок к каталожному: плитки встанут так, как задумано. */
export async function resetTileOrder(): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  await prisma.user.update({
    where: { id: session.user.id },
    data: { tileOrder: Prisma.DbNull },
  });
  revalidatePath(`/[locale]/me`, "page");
  revalidatePath(`/[locale]/me/settings/interface`, "page");
}
