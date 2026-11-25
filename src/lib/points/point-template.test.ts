// US-25 — "Как владелец сети, хочу применить шаблон к 50 пунктам: массовое
// применение тарифов и режима работы."
//
// §29.5 is the rule that makes this safe at all: tariffs and hours change
// without going back through moderation. A template that also carried the
// address would un-publish fifty points at once, so it does not.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  TemplateError,
  applyTemplate,
  deleteTemplate,
  readTemplates,
  saveTemplate,
} from "./point-template";
import { currentPricing } from "@/lib/pricing/pricing-service";

const PREFIX = "test_tmpl_";
const ZONE_CODE = "TESTTMPL";

let zoneId: string;
let operatorId: string;
let otherOperatorId: string;
let ownerUserId: string;
let strangerUserId: string;
let pointIds: string[] = [];
let foreignPointId: string;

async function wipe() {
  await prisma.pointTemplate.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.pricingRule.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

const TARIFFS = [
  {
    label: "night",
    fromMinute: 0,
    toMinute: 420,
    priceFiat: 0.2,
    currency: "EUR",
    priceTokens: 0.9,
    idleFeePerMin: null,
    coopDiscount: 10,
  },
  {
    label: "day",
    fromMinute: 420,
    toMinute: 1440,
    priceFiat: 0.45,
    currency: "EUR",
    priceTokens: 1.3,
    idleFeePerMin: 0.05,
    coopDiscount: 10,
  },
];

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Template zone", currency: "EUR" },
    })
  ).id;

  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: {},
        create: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  ownerUserId = await user("owner");
  strangerUserId = await user("stranger");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Template network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  otherOperatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}other`, displayName: "Somebody else" },
    })
  ).id;

  // Fifty points, which is the number the story names. In one statement: the
  // default hook timeout is five seconds, and fifty round trips under a
  // parallel suite is close enough to it to matter.
  await prisma.acceptancePoint.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({
      operatorId,
      type: "CHARGING_STATION" as const,
      name: `Point ${String(i).padStart(2, "0")}`,
      status: (i % 2 === 0 ? "PUBLISHED" : "DRAFT") as "PUBLISHED" | "DRAFT",
      gridZoneId: zoneId,
    })),
  });
  pointIds = (
    await prisma.acceptancePoint.findMany({
      where: { operatorId },
      orderBy: { name: "asc" },
      select: { id: true },
    })
  ).map((p) => p.id);
  foreignPointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId: otherOperatorId, type: "CHARGING_STATION", name: "Theirs" },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.pointTemplate.deleteMany({ where: { operatorId } });
  await prisma.pricingRule.deleteMany({ where: { operatorId } });
  await prisma.pointTariff.deleteMany({ where: { point: { operatorId } } });
  await prisma.acceptancePoint.updateMany({
    where: { operatorId },
    data: { open24: false, openHours: Prisma.DbNull, holidayNote: null },
  });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

const template = (over: Record<string, unknown> = {}) =>
  saveTemplate({
    operatorId,
    actorId: ownerUserId,
    name: "Winter 2026",
    tariffs: TARIFFS,
    open24: true,
    paymentMethods: ["TOKEN", "POOLWATT_CARD"],
    amenities: ["WC"],
    ...over,
  });

describe("saveTemplate", () => {
  it("keeps the tariffs and the hours as given", async () => {
    const t = await template();

    expect(t.name).toBe("Winter 2026");
    expect(t.open24).toBe(true);
    expect((t.tariffs as typeof TARIFFS)).toHaveLength(2);
    expect(t.paymentMethods).toEqual(["TOKEN", "POOLWATT_CARD"]);
    expect(t.createdById).toBe(ownerUserId);
  });

  it("updates a template of the same name rather than making a second", async () => {
    await template();
    const again = await template({ tariffs: [TARIFFS[0]] });

    expect((again.tariffs as typeof TARIFFS)).toHaveLength(1);
    expect(await prisma.pointTemplate.count({ where: { operatorId } })).toBe(1);
  });

  it("refuses somebody else's network", async () => {
    await expect(
      saveTemplate({
        operatorId,
        actorId: strangerUserId,
        name: "Theirs",
        tariffs: TARIFFS,
      }),
    ).rejects.toThrow(TemplateError);
  });

  it("refuses a tariff window that is not a window", async () => {
    await expect(
      template({ tariffs: [{ ...TARIFFS[0], fromMinute: 600, toMinute: 300 }] }),
    ).rejects.toThrow(/window/i);
    await expect(
      template({ tariffs: [{ ...TARIFFS[0], toMinute: 2000 }] }),
    ).rejects.toThrow(/minute/i);
  });

  it("refuses a negative price", async () => {
    await expect(template({ tariffs: [{ ...TARIFFS[0], priceFiat: -1 }] })).rejects.toThrow(
      /price/i,
    );
  });

  it("refuses a template with no tariff and no hours — it would do nothing", async () => {
    await expect(
      saveTemplate({ operatorId, actorId: ownerUserId, name: "Empty", tariffs: [] }),
    ).rejects.toThrow(/nothing/i);
  });
});

describe("applyTemplate — fifty points at once", () => {
  it("writes the tariffs and the hours onto every point named", async () => {
    const t = await template();

    const result = await applyTemplate({
      templateId: t.id,
      pointIds,
      actorId: ownerUserId,
    });

    expect(result.applied).toBe(50);

    const tariffs = await prisma.pointTariff.findMany({
      where: { pointId: pointIds[0] },
      orderBy: { fromMinute: "asc" },
    });
    expect(tariffs).toHaveLength(2);
    expect(Number(tariffs[0].priceFiat)).toBe(0.2);
    expect(tariffs[0].coopDiscount).toBe(10);

    const point = await prisma.acceptancePoint.findUniqueOrThrow({
      where: { id: pointIds[49] },
    });
    expect(point.open24).toBe(true);
    expect(point.paymentMethods).toEqual(["TOKEN", "POOLWATT_CARD"]);
  });

  it("applies to the whole network when no points are named", async () => {
    const t = await template();
    const result = await applyTemplate({ templateId: t.id, pointIds: null, actorId: ownerUserId });
    expect(result.applied).toBe(50);
  });

  it("replaces the old tariffs rather than piling onto them", async () => {
    await prisma.pointTariff.create({
      data: {
        pointId: pointIds[0],
        fromMinute: 0,
        toMinute: 1440,
        priceFiat: new Prisma.Decimal(9),
        currency: "EUR",
      },
    });
    const t = await template();
    await applyTemplate({ templateId: t.id, pointIds: [pointIds[0]], actorId: ownerUserId });

    const tariffs = await prisma.pointTariff.findMany({ where: { pointId: pointIds[0] } });
    expect(tariffs).toHaveLength(2);
    expect(tariffs.some((x) => Number(x.priceFiat) === 9)).toBe(false);
  });

  it("versions every point it touched (§54)", async () => {
    const t = await template();
    await applyTemplate({ templateId: t.id, pointIds: pointIds.slice(0, 3), actorId: ownerUserId });

    for (const pointId of pointIds.slice(0, 3)) {
      const rule = await currentPricing("POINT_TARIFF", pointId);
      expect(rule?.version).toBe(1);
      expect(rule?.note).toMatch(/Winter 2026/);
    }
  });

  it("leaves the moderation status alone (§29.5)", async () => {
    const t = await template();
    const before = await prisma.acceptancePoint.findMany({
      where: { operatorId },
      select: { id: true, status: true },
      orderBy: { name: "asc" },
    });

    await applyTemplate({ templateId: t.id, pointIds: null, actorId: ownerUserId });

    const after = await prisma.acceptancePoint.findMany({
      where: { operatorId },
      select: { id: true, status: true },
      orderBy: { name: "asc" },
    });
    expect(after).toEqual(before);
  });

  it("never touches another network's point, even when asked", async () => {
    const t = await template();

    await expect(
      applyTemplate({
        templateId: t.id,
        pointIds: [pointIds[0], foreignPointId],
        actorId: ownerUserId,
      }),
    ).rejects.toThrow(/network/i);

    expect(await prisma.pointTariff.count({ where: { pointId: foreignPointId } })).toBe(0);
  });

  it("refuses a stranger", async () => {
    const t = await template();
    await expect(
      applyTemplate({ templateId: t.id, pointIds: null, actorId: strangerUserId }),
    ).rejects.toThrow(TemplateError);
  });

  it("records when it was last applied and to how many", async () => {
    const t = await template();
    await applyTemplate({ templateId: t.id, pointIds: pointIds.slice(0, 7), actorId: ownerUserId });

    const after = await prisma.pointTemplate.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.lastAppliedCount).toBe(7);
    expect(after.lastAppliedAt).not.toBeNull();
  });

  it("writes one audit entry for the whole run, not fifty", async () => {
    const t = await template();
    await applyTemplate({ templateId: t.id, pointIds: null, actorId: ownerUserId });

    const logs = await prisma.auditLog.findMany({
      where: { entity: "PointTemplate", entityId: t.id, action: "point.template.applied" },
    });
    expect(logs).toHaveLength(1);
    expect((logs[0].after as { applied: number }).applied).toBe(50);
  });
});

describe("readTemplates / deleteTemplate", () => {
  it("lists the network's templates, newest first", async () => {
    await template({ name: "First" });
    await template({ name: "Second" });

    const rows = await readTemplates(operatorId, ownerUserId);
    expect(rows.map((r) => r.name)).toEqual(["Second", "First"]);
  });

  it("deletes one, and leaves the points as they are", async () => {
    const t = await template();
    await applyTemplate({ templateId: t.id, pointIds: [pointIds[0]], actorId: ownerUserId });
    await deleteTemplate(t.id, ownerUserId);

    expect(await prisma.pointTemplate.findUnique({ where: { id: t.id } })).toBeNull();
    expect(await prisma.pointTariff.count({ where: { pointId: pointIds[0] } })).toBe(2);
  });

  it("refuses a stranger's list and a stranger's delete", async () => {
    const t = await template();
    await expect(readTemplates(operatorId, strangerUserId)).rejects.toThrow(TemplateError);
    await expect(deleteTemplate(t.id, strangerUserId)).rejects.toThrow(TemplateError);
  });
});
