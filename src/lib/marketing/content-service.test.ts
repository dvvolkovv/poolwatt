// US-40 — "загрузить баннер и видео в карточку своей станции". The criteria
// are upload, preview, submission to moderation and publication on schedule.
// The schedule itself is `visibility.ts`; what belongs here is whose content
// it is, what counts as complete enough to submit, and what the operator's
// decision does to it.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ContentError,
  attachAsset,
  createContent,
  decideContent,
  deleteContent,
  fetchAsset,
  readLiveContent,
  readMiniBanners,
  readNetworkContent,
  readViewerFacts,
  submitForReview,
  updateContent,
} from "./content-service";

const PREFIX = "test_mkt_";
const ZONE_CODE = "TESTMKT";

let operatorId: string;
let ownerUserId: string;
let adminUserId: string;
let strangerUserId: string;
let zoneId: string;
let pointA: string;
let pointB: string;
let mediaDir: string;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function box(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length + 8, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, payload]);
}

function mp4(durationMs: number): Buffer {
  const p = Buffer.alloc(100);
  p.writeUInt32BE(1000, 12);
  p.writeUInt32BE(durationMs, 16);
  return Buffer.concat([
    box("ftyp", Buffer.from("isommp42", "latin1")),
    box("moov", box("mvhd", p)),
  ]);
}

async function wipe() {
  await prisma.marketingContent.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.payment.deleteMany({ where: { wallet: { owner: { username: { startsWith: PREFIX } } } } });
  await prisma.wallet.deleteMany({ where: { owner: { username: { startsWith: PREFIX } } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

beforeAll(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), "poolwatt-content-"));
  process.env.MARKETING_MEDIA_DIR = mediaDir;

  await wipe();
  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Marketing test zone", currency: "EUR" },
    })
  ).id;

  const user = async (name: string, role: "USER" | "ADMIN" = "USER") =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: { role },
        create: { username: `${PREFIX}${name}`, passwordHash: "x", role },
      })
    ).id;

  ownerUserId = await user("owner");
  adminUserId = await user("admin", "ADMIN");
  strangerUserId = await user("stranger");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Marketing test network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;

  pointA = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Point A", status: "PUBLISHED", gridZoneId: zoneId },
    })
  ).id;
  pointB = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Point B", status: "PUBLISHED", gridZoneId: zoneId },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.marketingContent.deleteMany({ where: { operatorId } });
});

afterAll(async () => {
  delete process.env.MARKETING_MEDIA_DIR;
  await rm(mediaDir, { recursive: true, force: true });
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("createContent — content belongs to a network and starts as a draft", () => {
  it("opens a draft, so nothing typed is lost before the file arrives", async () => {
    const c = await createContent(operatorId, ownerUserId, {
      type: "BANNER",
      title: "Half price on Sundays",
      placements: ["FULL_CARD", "NAVIGATOR_MINI"],
    });

    expect(c.status).toBe("DRAFT");
    expect(c.operatorId).toBe(operatorId);
    expect(c.placements).toEqual(["FULL_CARD", "NAVIGATOR_MINI"]);
  });

  it("refuses somebody else's network", async () => {
    await expect(
      createContent(operatorId, strangerUserId, { type: "NEWS", title: "Hello" }),
    ).rejects.toThrow(ContentError);
  });

  it("refuses a place that is not a place", async () => {
    await expect(
      createContent(operatorId, ownerUserId, {
        type: "BANNER",
        title: "x",
        placements: ["BILLBOARD"],
      }),
    ).rejects.toThrow(/place/i);
  });

  it("refuses a point that is not in this network", async () => {
    const other = await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}other`, displayName: "Other" },
    });
    const foreign = await prisma.acceptancePoint.create({
      data: { operatorId: other.id, type: "CHARGING_STATION", name: "Foreign" },
    });
    await expect(
      createContent(operatorId, ownerUserId, {
        type: "NEWS",
        title: "x",
        pointIds: [foreign.id],
      }),
    ).rejects.toThrow(/point/i);
  });

  it("refuses an hour window outside the day", async () => {
    await expect(
      createContent(operatorId, ownerUserId, { type: "NEWS", title: "x", hourFrom: 9, hourTo: 25 }),
    ).rejects.toThrow(ContentError);
  });

  it("refuses dates that run backwards", async () => {
    await expect(
      createContent(operatorId, ownerUserId, {
        type: "NEWS",
        title: "x",
        startsAt: new Date("2026-12-01T00:00:00Z"),
        endsAt: new Date("2026-11-01T00:00:00Z"),
      }),
    ).rejects.toThrow(/end/i);
  });
});

describe("attachAsset — §41's limits on the files themselves", () => {
  it("stores the file and the row that says what it is", async () => {
    const c = await createContent(operatorId, ownerUserId, { type: "BANNER", title: "b" });
    const asset = await attachAsset(c.id, ownerUserId, JPEG);

    expect(asset.contentType).toBe("image/jpeg");
    expect(asset.sizeBytes).toBe(JPEG.length);
    expect(asset.durationMs).toBeNull();
  });

  it("keeps a banner to one picture", async () => {
    const c = await createContent(operatorId, ownerUserId, { type: "BANNER", title: "b" });
    await attachAsset(c.id, ownerUserId, JPEG);
    await expect(attachAsset(c.id, ownerUserId, JPEG)).rejects.toThrow(/one/i);
  });

  it("keeps a gallery to ten pictures", async () => {
    const c = await createContent(operatorId, ownerUserId, { type: "GALLERY", title: "g" });
    for (let i = 0; i < 10; i++) await attachAsset(c.id, ownerUserId, JPEG);
    await expect(attachAsset(c.id, ownerUserId, JPEG)).rejects.toThrow(/ten|10/i);
  });

  it("records how long the video runs", async () => {
    const c = await createContent(operatorId, ownerUserId, { type: "VIDEO", title: "v" });
    const asset = await attachAsset(c.id, ownerUserId, mp4(42_000));
    expect(asset.durationMs).toBe(42_000);
  });

  it("will not put a video under a banner, or a picture under a video", async () => {
    const banner = await createContent(operatorId, ownerUserId, { type: "BANNER", title: "b" });
    await expect(attachAsset(banner.id, ownerUserId, mp4(10_000))).rejects.toThrow(/image/i);

    const video = await createContent(operatorId, ownerUserId, { type: "VIDEO", title: "v" });
    await expect(attachAsset(video.id, ownerUserId, JPEG)).rejects.toThrow(/video/i);
  });

  it("refuses a stranger", async () => {
    const c = await createContent(operatorId, ownerUserId, { type: "BANNER", title: "b" });
    await expect(attachAsset(c.id, strangerUserId, JPEG)).rejects.toThrow(ContentError);
  });
});

describe("submitForReview — US-40 'отправка на модерацию'", () => {
  it("will not send a banner with no picture", async () => {
    const c = await createContent(operatorId, ownerUserId, { type: "BANNER", title: "b" });
    await expect(submitForReview(c.id, ownerUserId)).rejects.toThrow(/picture|image|file/i);
  });

  it("will not send a link with no link", async () => {
    const c = await createContent(operatorId, ownerUserId, { type: "LINK", title: "site" });
    await expect(submitForReview(c.id, ownerUserId)).rejects.toThrow(/link/i);
  });

  it("will not send a promotion with no conditions written out", async () => {
    const c = await createContent(operatorId, ownerUserId, { type: "PROMO", title: "Sale" });
    await expect(submitForReview(c.id, ownerUserId)).rejects.toThrow(/condition|text|body/i);
  });

  it("sends a complete banner and stamps when", async () => {
    const c = await createContent(operatorId, ownerUserId, { type: "BANNER", title: "b" });
    await attachAsset(c.id, ownerUserId, JPEG);
    const sent = await submitForReview(c.id, ownerUserId);

    expect(sent.status).toBe("REVIEW");
    expect(sent.submittedAt).not.toBeNull();
  });

  it("is not public until the operator says so", async () => {
    const c = await createContent(operatorId, ownerUserId, {
      type: "BANNER",
      title: "b",
      placements: ["FULL_CARD"],
    });
    await attachAsset(c.id, ownerUserId, JPEG);
    await submitForReview(c.id, ownerUserId);

    const live = await readLiveContent(pointA, "FULL_CARD", null);
    expect(live).toHaveLength(0);
  });
});

describe("decideContent — §41 'Модерация оператором Poolwatt'", () => {
  async function submitted() {
    const c = await createContent(operatorId, ownerUserId, {
      type: "BANNER",
      title: "b",
      placements: ["FULL_CARD"],
    });
    await attachAsset(c.id, ownerUserId, JPEG);
    return submitForReview(c.id, ownerUserId);
  }

  it("publishes on approval", async () => {
    const c = await submitted();
    const decided = await decideContent(c.id, adminUserId, true, null);

    expect(decided.status).toBe("APPROVED");
    expect(decided.reviewedById).toBe(adminUserId);
    expect(await readLiveContent(pointA, "FULL_CARD", null)).toHaveLength(1);
  });

  it("sends a refusal back to the draft with the reason the partner reads", async () => {
    const c = await submitted();
    const decided = await decideContent(c.id, adminUserId, false, "The claim about free energy is not true");

    expect(decided.status).toBe("REJECTED");
    expect(decided.reviewNote).toMatch(/not true/);
    expect(await readLiveContent(pointA, "FULL_CARD", null)).toHaveLength(0);
  });

  it("is the Poolwatt operator's decision, not the partner's", async () => {
    const c = await submitted();
    await expect(decideContent(c.id, ownerUserId, true, null)).rejects.toThrow(ContentError);
  });

  it("only decides what was actually submitted", async () => {
    const c = await createContent(operatorId, ownerUserId, { type: "NEWS", title: "n" });
    await expect(decideContent(c.id, adminUserId, true, null)).rejects.toThrow(/review/i);
  });

  it("lets a rejected piece be corrected and sent again", async () => {
    const c = await submitted();
    await decideContent(c.id, adminUserId, false, "Rewrite the claim");
    await updateContent(c.id, ownerUserId, { title: "Honest title" });
    const again = await submitForReview(c.id, ownerUserId);

    expect(again.status).toBe("REVIEW");
    expect(again.reviewNote).toBeNull();
  });
});

describe("readLiveContent — what a point card shows", () => {
  async function approved(over: Parameters<typeof createContent>[2]) {
    const c = await createContent(operatorId, ownerUserId, over);
    if (over.type === "BANNER" || over.type === "GALLERY") await attachAsset(c.id, ownerUserId, JPEG);
    await prisma.marketingContent.update({
      where: { id: c.id },
      data: { status: "APPROVED", submittedAt: new Date(), reviewedAt: new Date() },
    });
    return c;
  }

  it("shows network-wide content on any point of the network", async () => {
    await approved({ type: "NEWS", title: "Everywhere", body: "x", placements: ["FULL_CARD"] });
    expect(await readLiveContent(pointA, "FULL_CARD", null)).toHaveLength(1);
    expect(await readLiveContent(pointB, "FULL_CARD", null)).toHaveLength(1);
  });

  it("shows content scoped to one point only there", async () => {
    await approved({
      type: "NEWS",
      title: "Only A",
      body: "x",
      placements: ["FULL_CARD"],
      pointIds: [pointA],
    });
    expect(await readLiveContent(pointA, "FULL_CARD", null)).toHaveLength(1);
    expect(await readLiveContent(pointB, "FULL_CARD", null)).toHaveLength(0);
  });

  it("shows the banner in the navigator's mini-card and nothing else", async () => {
    await approved({
      type: "BANNER",
      title: "Banner",
      placements: ["FULL_CARD", "NAVIGATOR_MINI"],
    });
    await approved({
      type: "NEWS",
      title: "News",
      body: "x",
      placements: ["FULL_CARD"],
    });

    const mini = await readLiveContent(pointA, "NAVIGATOR_MINI", null);
    expect(mini.map((c) => c.type)).toEqual(["BANNER"]);
  });

  it("keeps out of schedule content out", async () => {
    const c = await approved({ type: "NEWS", title: "Expired", body: "x", placements: ["FULL_CARD"] });
    await prisma.marketingContent.update({
      where: { id: c.id },
      data: { endsAt: new Date("2026-01-01T00:00:00Z") },
    });
    expect(await readLiveContent(pointA, "FULL_CARD", null)).toHaveLength(0);
  });

  it("says nothing about a point that is not ours", async () => {
    expect(await readLiveContent("no-such-point", "FULL_CARD", null)).toEqual([]);
  });
});

describe("readViewerFacts — §41's targeting needs facts, not guesses", () => {
  it("calls a signed-out visitor a newcomer with no charges", async () => {
    const facts = await readViewerFacts(null, operatorId);
    expect(facts).toEqual({ signedIn: false, chargesInNetwork: 0, coopMember: false, cardHolder: false });
  });

  it("counts only captured charges at the points of this network", async () => {
    const wallet = await prisma.wallet.create({
      data: { ownerUserId: strangerUserId, zoneId },
    });
    await prisma.payment.create({
      data: {
        walletId: wallet.id,
        zoneId,
        pointId: pointA,
        requestedKwh: new Prisma.Decimal(10),
        status: "CAPTURED",
        capturedAt: new Date(),
      },
    });
    // A failed session is not a visit, and a session somewhere else is not
    // this network's business.
    await prisma.payment.create({
      data: {
        walletId: wallet.id,
        zoneId,
        pointId: pointA,
        requestedKwh: new Prisma.Decimal(10),
        status: "FAILED",
      },
    });
    await prisma.payment.create({
      data: {
        walletId: wallet.id,
        zoneId,
        requestedKwh: new Prisma.Decimal(10),
        status: "CAPTURED",
        capturedAt: new Date(),
      },
    });

    const facts = await readViewerFacts(strangerUserId, operatorId);
    expect(facts.chargesInNetwork).toBe(1);
    expect(facts.signedIn).toBe(true);
    // §19 waits for the EMI: nobody holds a card.
    expect(facts.cardHolder).toBe(false);
  });
});

describe("readNetworkContent / deleteContent — the cabinet list", () => {
  it("lists the network's own content, newest first, with its files", async () => {
    const a = await createContent(operatorId, ownerUserId, { type: "BANNER", title: "First" });
    await attachAsset(a.id, ownerUserId, JPEG);
    await createContent(operatorId, ownerUserId, { type: "NEWS", title: "Second" });

    const rows = await readNetworkContent(operatorId, ownerUserId);
    expect(rows.map((r) => r.title)).toEqual(["Second", "First"]);
    expect(rows.find((r) => r.title === "First")!.assets).toHaveLength(1);
  });

  it("deletes the row and the files behind it", async () => {
    const c = await createContent(operatorId, ownerUserId, { type: "BANNER", title: "b" });
    await attachAsset(c.id, ownerUserId, JPEG);
    await deleteContent(c.id, ownerUserId);

    expect(await prisma.marketingContent.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await prisma.marketingAsset.count({ where: { contentId: c.id } })).toBe(0);
  });

  it("refuses a stranger's list and a stranger's delete", async () => {
    const c = await createContent(operatorId, ownerUserId, { type: "NEWS", title: "n" });
    await expect(readNetworkContent(operatorId, strangerUserId)).rejects.toThrow(ContentError);
    await expect(deleteContent(c.id, strangerUserId)).rejects.toThrow(ContentError);
  });
});

describe("fetchAsset — who may see the bytes", () => {
  async function bannerWith(status: "DRAFT" | "REVIEW" | "APPROVED", endsAt: Date | null = null) {
    const c = await createContent(operatorId, ownerUserId, {
      type: "BANNER",
      title: "b",
      placements: ["FULL_CARD"],
    });
    const asset = await attachAsset(c.id, ownerUserId, JPEG);
    await prisma.marketingContent.update({ where: { id: c.id }, data: { status, endsAt } });
    return asset.id;
  }

  it("hands an approved, in-schedule banner to anyone — the point card is public", async () => {
    const assetId = await bannerWith("APPROVED");
    const res = await fetchAsset({ assetId, userId: null, isAdmin: false });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.mime).toBe("image/jpeg");
    expect(res.bytes.equals(JPEG)).toBe(true);
  });

  it("hides a draft from the public but shows it to its owner — that is the preview", async () => {
    const assetId = await bannerWith("DRAFT");

    expect((await fetchAsset({ assetId, userId: null, isAdmin: false })).status).toBe("not-found");
    expect((await fetchAsset({ assetId, userId: strangerUserId, isAdmin: false })).status).toBe("not-found");
    expect((await fetchAsset({ assetId, userId: ownerUserId, isAdmin: false })).status).toBe("ok");
  });

  it("shows what is waiting in the queue to the moderator deciding it", async () => {
    const assetId = await bannerWith("REVIEW");
    expect((await fetchAsset({ assetId, userId: adminUserId, isAdmin: true })).status).toBe("ok");
  });

  it("hides an approved banner whose schedule has run out", async () => {
    const assetId = await bannerWith("APPROVED", new Date("2026-01-01T00:00:00Z"));
    expect((await fetchAsset({ assetId, userId: null, isAdmin: false })).status).toBe("not-found");
    // Its owner still sees it: they are about to fix the dates.
    expect((await fetchAsset({ assetId, userId: ownerUserId, isAdmin: false })).status).toBe("ok");
  });

  it("says not-found for a file that does not exist", async () => {
    expect((await fetchAsset({ assetId: "nope", userId: null, isAdmin: false })).status).toBe("not-found");
  });
});

describe("readMiniBanners — one query for a whole map viewport", () => {
  async function approvedBanner(pointIds: string[] = []) {
    const c = await createContent(operatorId, ownerUserId, {
      type: "BANNER",
      title: "Mini",
      placements: ["NAVIGATOR_MINI"],
      pointIds,
    });
    const asset = await attachAsset(c.id, ownerUserId, JPEG);
    await prisma.marketingContent.update({ where: { id: c.id }, data: { status: "APPROVED" } });
    return asset.id;
  }

  it("gives every point of the network the network's banner", async () => {
    const assetId = await approvedBanner();
    const map = await readMiniBanners([pointA, pointB], null);

    expect(map.get(pointA)).toBe(assetId);
    expect(map.get(pointB)).toBe(assetId);
  });

  it("gives a point-scoped banner only to its own point", async () => {
    const assetId = await approvedBanner([pointB]);
    const map = await readMiniBanners([pointA, pointB], null);

    expect(map.has(pointA)).toBe(false);
    expect(map.get(pointB)).toBe(assetId);
  });

  it("says nothing when there is nothing approved", async () => {
    expect((await readMiniBanners([pointA], null)).size).toBe(0);
  });

  it("asks for nothing when given nothing", async () => {
    expect((await readMiniBanners([], null)).size).toBe(0);
  });
});
