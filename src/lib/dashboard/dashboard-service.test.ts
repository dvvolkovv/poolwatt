// US-27 against the real database: layouts are saved, edited, deleted, and
// one of them is the default. The rules of a layout are unit-tested in
// widgets.test.ts; here it is ownership and the default flag.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  DashboardError,
  deleteLayout,
  readLayouts,
  readActiveLayout,
  saveLayout,
} from "./dashboard-service";
import { DEFAULT_LAYOUT } from "./widgets";

const PREFIX = "test_dash_";
let ownerId: string;
let strangerId: string;

beforeAll(async () => {
  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: {},
        create: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  ownerId = await user("owner");
  strangerId = await user("stranger");
});

afterAll(async () => {
  await prisma.dashboard.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

beforeEach(async () => {
  await prisma.dashboard.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
});

describe("saveLayout — US-27", () => {
  it("saves a named layout and makes the first one the default", async () => {
    const saved = await saveLayout({
      userId: ownerId,
      name: "Finances",
      widgets: [
        { key: "revenue", size: "M" },
        { key: "avgPrice", size: "S" },
      ],
    });
    expect(saved.name).toBe("Finances");
    expect(saved.isDefault).toBe(true);
    expect(saved.widgets).toEqual([
      { key: "revenue", size: "M" },
      { key: "avgPrice", size: "S" },
    ]);
  });

  it("edits a layout of the same name instead of making a second one", async () => {
    await saveLayout({ userId: ownerId, name: "Morning", widgets: [{ key: "nowKw", size: "L" }] });
    await saveLayout({
      userId: ownerId,
      name: "Morning",
      widgets: [
        { key: "nowKw", size: "M" },
        { key: "today", size: "S" },
      ],
    });
    const layouts = await readLayouts(ownerId);
    expect(layouts).toHaveLength(1);
    expect(layouts[0].widgets).toHaveLength(2);
  });

  it("keeps one default and moves it on request", async () => {
    await saveLayout({ userId: ownerId, name: "Morning", widgets: [{ key: "nowKw", size: "S" }] });
    await saveLayout({ userId: ownerId, name: "Tech", widgets: [{ key: "equipment", size: "L" }] });
    await saveLayout({
      userId: ownerId,
      name: "Tech",
      widgets: [{ key: "equipment", size: "L" }],
      isDefault: true,
    });

    const layouts = await readLayouts(ownerId);
    expect(layouts.filter((l) => l.isDefault).map((l) => l.name)).toEqual(["Tech"]);
  });

  it("refuses a layout the page could not draw", async () => {
    await expect(
      saveLayout({ userId: ownerId, name: "Broken", widgets: [] }),
    ).rejects.toThrow(/empty|widget/i);
    await expect(
      saveLayout({
        userId: ownerId,
        name: "Broken",
        widgets: [{ key: "co2", size: "S" }] as never,
      }),
    ).rejects.toThrow(/co2/);
  });

  it("refuses a nameless layout", async () => {
    await expect(
      saveLayout({ userId: ownerId, name: "  ", widgets: [{ key: "today", size: "S" }] }),
    ).rejects.toThrow(DashboardError);
  });
});

describe("readActiveLayout — what the console draws", () => {
  it("is the built-in panel when nothing has been set up", async () => {
    const active = await readActiveLayout(ownerId, null);
    expect(active.name).toBeNull();
    expect(active.widgets).toEqual(DEFAULT_LAYOUT);
  });

  it("is the default layout once there is one", async () => {
    await saveLayout({ userId: ownerId, name: "Morning", widgets: [{ key: "nowKw", size: "L" }] });
    const active = await readActiveLayout(ownerId, null);
    expect(active.name).toBe("Morning");
    expect(active.widgets).toEqual([{ key: "nowKw", size: "L" }]);
  });

  it("is the one asked for by name", async () => {
    await saveLayout({ userId: ownerId, name: "Morning", widgets: [{ key: "nowKw", size: "L" }] });
    await saveLayout({ userId: ownerId, name: "Tech", widgets: [{ key: "equipment", size: "L" }] });
    const active = await readActiveLayout(ownerId, "Tech");
    expect(active.name).toBe("Tech");
  });

  it("falls back to the default when the name is not theirs", async () => {
    await saveLayout({ userId: ownerId, name: "Morning", widgets: [{ key: "nowKw", size: "L" }] });
    await saveLayout({ userId: strangerId, name: "Theirs", widgets: [{ key: "today", size: "S" }] });
    const active = await readActiveLayout(ownerId, "Theirs");
    expect(active.name).toBe("Morning");
  });
});

describe("deleteLayout", () => {
  it("removes one of the owner's layouts and hands the default on", async () => {
    await saveLayout({ userId: ownerId, name: "Morning", widgets: [{ key: "nowKw", size: "S" }] });
    await saveLayout({ userId: ownerId, name: "Tech", widgets: [{ key: "equipment", size: "L" }] });

    await deleteLayout({ userId: ownerId, name: "Morning" });
    const layouts = await readLayouts(ownerId);
    expect(layouts.map((l) => l.name)).toEqual(["Tech"]);
    // The panel still has a default: the console must not be left without one.
    expect(layouts[0].isDefault).toBe(true);
  });

  it("will not touch somebody else's layout", async () => {
    await saveLayout({ userId: strangerId, name: "Theirs", widgets: [{ key: "today", size: "S" }] });
    await expect(deleteLayout({ userId: ownerId, name: "Theirs" })).rejects.toThrow(DashboardError);
    expect(await readLayouts(strangerId)).toHaveLength(1);
  });
});
