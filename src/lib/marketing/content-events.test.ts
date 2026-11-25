// §44 "Показы и клики по контенту, просмотры видео", US-44: what the browser
// is allowed to record, against the real database.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ContentEventError, recordContentEvent } from "./content-events";

const PREFIX = "test_cev_";
let operatorId: string;
let publishedId: string;
let draftId: string;
let pointId: string;
let userId: string;

async function wipe() {
  await prisma.contentEvent.deleteMany({
    where: { content: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.marketingContent.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: "TESTCEV" } });
}

beforeAll(async () => {
  await wipe();
  userId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}viewer` },
      update: {},
      create: { username: `${PREFIX}viewer`, passwordHash: "x" },
    })
  ).id;
  const zoneId = (
    await prisma.gridZone.create({
      data: { code: "TESTCEV", country: "SK", name: "Content event zone" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Content event network" },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "P", gridZoneId: zoneId },
    })
  ).id;
  publishedId = (
    await prisma.marketingContent.create({
      data: { operatorId, type: "BANNER", title: "Shown", status: "APPROVED" },
    })
  ).id;
  draftId = (
    await prisma.marketingContent.create({
      data: { operatorId, type: "BANNER", title: "Not shown", status: "DRAFT" },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

beforeEach(async () => {
  await prisma.contentEvent.deleteMany({ where: { content: { operatorId } } });
});

describe("recordContentEvent — US-44", () => {
  it("records a show of published content, with the viewer when there is one", async () => {
    await recordContentEvent({ contentId: publishedId, kind: "IMPRESSION", userId, pointId });
    const [row] = await prisma.contentEvent.findMany({ where: { contentId: publishedId } });
    expect(row.kind).toBe("IMPRESSION");
    expect(row.userId).toBe(userId);
    expect(row.pointId).toBe(pointId);
  });

  it("records a show seen by a visitor who is not signed in", async () => {
    await recordContentEvent({ contentId: publishedId, kind: "CLICK", userId: null });
    const [row] = await prisma.contentEvent.findMany({ where: { contentId: publishedId } });
    expect(row.userId).toBeNull();
  });

  it("refuses content nobody approved — a draft cannot be inflated", async () => {
    await expect(
      recordContentEvent({ contentId: draftId, kind: "IMPRESSION", userId: null }),
    ).rejects.toThrow(ContentEventError);
    expect(await prisma.contentEvent.count({ where: { contentId: draftId } })).toBe(0);
  });

  it("refuses content that does not exist", async () => {
    await expect(
      recordContentEvent({ contentId: "nope", kind: "IMPRESSION", userId: null }),
    ).rejects.toThrow(ContentEventError);
  });

  it("refuses an event kind it cannot count", async () => {
    await expect(
      recordContentEvent({
        contentId: publishedId,
        kind: "SOMETHING" as never,
        userId: null,
      }),
    ).rejects.toThrow(ContentEventError);
  });

  it("refuses a point that is not of this content's network", async () => {
    const other = await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}other`, displayName: "Other" },
    });
    const foreignPoint = await prisma.acceptancePoint.create({
      data: {
        operatorId: other.id,
        type: "CHARGING_STATION",
        name: "Theirs",
        gridZoneId: (await prisma.gridZone.findFirstOrThrow({ where: { code: "TESTCEV" } })).id,
      },
    });
    await expect(
      recordContentEvent({
        contentId: publishedId,
        kind: "IMPRESSION",
        userId: null,
        pointId: foreignPoint.id,
      }),
    ).rejects.toThrow(ContentEventError);
  });
});
