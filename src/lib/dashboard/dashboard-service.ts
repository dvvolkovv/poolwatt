// Saved widget panels — ТЗ §30, US-27.
//
// The console asks for one layout and gets something it can always draw: the
// one named in the address, the default, or the built-in panel. Nothing else
// in the app needs to know whether the producer ever opened the editor.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "@/lib/exchange/audit";
import { DEFAULT_LAYOUT, parseLayout, type WidgetPlacement } from "./widgets";

export class DashboardError extends Error {}

/** How many panels one person may keep — §30 names three, this leaves room. */
const MAX_LAYOUTS = 10;

export interface SavedLayout {
  id: string;
  name: string;
  widgets: WidgetPlacement[];
  isDefault: boolean;
  updatedAt: Date;
}

function toSaved(row: {
  id: string;
  name: string;
  widgets: Prisma.JsonValue;
  isDefault: boolean;
  updatedAt: Date;
}): SavedLayout {
  return {
    id: row.id,
    name: row.name,
    // A row written by an older catalogue could hold a widget this build no
    // longer draws; the built-in panel is a better answer than a crash.
    widgets: safeLayout(row.widgets),
    isDefault: row.isDefault,
    updatedAt: row.updatedAt,
  };
}

function safeLayout(value: Prisma.JsonValue): WidgetPlacement[] {
  try {
    return parseLayout(value);
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export async function readLayouts(userId: string, db: Db = prisma): Promise<SavedLayout[]> {
  const rows = await db.dashboard.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return rows.map(toSaved);
}

export interface ActiveLayout {
  /** Null when nothing has been saved and the built-in panel is shown. */
  name: string | null;
  widgets: WidgetPlacement[];
}

/**
 * The panel to draw: the one asked for by name, else the default, else the
 * built-in one. A name that belongs to somebody else is simply not found —
 * the console falls back rather than refusing to render.
 */
export async function readActiveLayout(
  userId: string,
  name: string | null,
  db: Db = prisma,
): Promise<ActiveLayout> {
  const layouts = await readLayouts(userId, db);
  if (layouts.length === 0) return { name: null, widgets: DEFAULT_LAYOUT };

  const asked = name ? layouts.find((l) => l.name === name) : null;
  const chosen = asked ?? layouts.find((l) => l.isDefault) ?? layouts[0];
  return { name: chosen.name, widgets: chosen.widgets };
}

export interface SaveLayoutInput {
  userId: string;
  name: string;
  widgets: unknown;
  /** Make this the panel the console opens with. */
  isDefault?: boolean;
}

/**
 * Save a panel under its name — the same name twice is an edit, not a second
 * panel, because that is what the producer means by it.
 */
export async function saveLayout(input: SaveLayoutInput): Promise<SavedLayout> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 40) {
    throw new DashboardError("A layout needs a name of up to 40 characters");
  }
  const widgets = parseLayout(input.widgets);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.dashboard.findUnique({
      where: { userId_name: { userId: input.userId, name } },
    });
    if (!existing) {
      const count = await tx.dashboard.count({ where: { userId: input.userId } });
      if (count >= MAX_LAYOUTS) {
        throw new DashboardError(`No more than ${MAX_LAYOUTS} layouts`);
      }
    }

    // The first panel is the default by definition: there is nothing else for
    // the console to open with.
    const hasDefault = await tx.dashboard.findFirst({
      where: { userId: input.userId, isDefault: true },
      select: { id: true },
    });
    const isDefault =
      input.isDefault ?? (hasDefault == null || hasDefault.id === existing?.id);

    if (isDefault) {
      await tx.dashboard.updateMany({
        where: { userId: input.userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const row = await tx.dashboard.upsert({
      where: { userId_name: { userId: input.userId, name } },
      update: { widgets: widgets as unknown as Prisma.InputJsonValue, isDefault },
      create: {
        userId: input.userId,
        name,
        widgets: widgets as unknown as Prisma.InputJsonValue,
        isDefault,
      },
    });
    return toSaved(row);
  });
}

export async function deleteLayout(args: { userId: string; name: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.dashboard.findUnique({
      where: { userId_name: { userId: args.userId, name: args.name } },
    });
    if (!row) throw new DashboardError("No such layout");

    await tx.dashboard.delete({ where: { id: row.id } });

    // Never leave the console without a panel to open with.
    if (row.isDefault) {
      const next = await tx.dashboard.findFirst({
        where: { userId: args.userId },
        orderBy: { name: "asc" },
        select: { id: true },
      });
      if (next) {
        await tx.dashboard.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }
  });
}
