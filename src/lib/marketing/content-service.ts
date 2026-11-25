// A partner's marketing content — ТЗ §41, US-40.
//
// One service behind both callers: the browser form in the cabinet (server
// actions) and `POST /v1/partners/{id}/content`. Ownership is checked here and
// nowhere else, so neither caller can forget.

import type { MarketingAudience, MarketingContentType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteMedia, isVideo, readMedia, saveMedia } from "./media-storage";
import {
  type ContentForDisplay,
  PLACEMENTS,
  type Placement,
  type ViewerFacts,
  isContentLive,
  selectForPlacement,
} from "./visibility";

export class ContentError extends Error {}

/** §41 — a gallery is a gallery, not an album. */
export const MAX_GALLERY_ASSETS = 10;

export interface ContentInput {
  type: MarketingContentType;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  placements?: string[];
  audience?: MarketingAudience;
  pointIds?: string[];
  zoneId?: string | null;
  radiusKm?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  weekdays?: number[];
  hourFrom?: number | null;
  hourTo?: number | null;
}

/** The partner is the person who claimed the network (§29, same as points). */
async function requireNetwork(operatorId: string, userId: string) {
  const op = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { id: true, claimedById: true, displayName: true },
  });
  if (!op) throw new ContentError("No such network");
  if (!op.claimedById || op.claimedById !== userId) {
    throw new ContentError("This network belongs to somebody else");
  }
  return op;
}

async function requireOwnedContent(contentId: string, userId: string) {
  const content = await prisma.marketingContent.findUnique({
    where: { id: contentId },
    include: { operator: { select: { claimedById: true } }, assets: true },
  });
  if (!content) throw new ContentError("No such content");
  if (content.operator.claimedById !== userId) {
    throw new ContentError("This content belongs to somebody else");
  }
  return content;
}

function validatePlacements(placements: string[]): void {
  for (const p of placements) {
    if (!PLACEMENTS.includes(p as Placement)) {
      throw new ContentError(`"${p}" is not a place content can be shown in`);
    }
  }
}

function validateSchedule(input: Partial<ContentInput>): void {
  const { startsAt, endsAt, hourFrom, hourTo, weekdays } = input;
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new ContentError("The end of the schedule is before its start");
  }
  for (const h of [hourFrom, hourTo]) {
    if (h != null && (!Number.isInteger(h) || h < 0 || h > 23)) {
      throw new ContentError("Hours of display run from 0 to 23");
    }
  }
  if ((hourFrom == null) !== (hourTo == null)) {
    throw new ContentError("An hour window needs both ends");
  }
  for (const d of weekdays ?? []) {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      throw new ContentError("Days of the week run from 0 (Sunday) to 6");
    }
  }
  if (input.radiusKm != null && (!Number.isInteger(input.radiusKm) || input.radiusKm <= 0)) {
    throw new ContentError("The radius is a positive number of kilometres");
  }
}

async function validatePoints(operatorId: string, pointIds: string[]): Promise<void> {
  if (pointIds.length === 0) return;
  const mine = await prisma.acceptancePoint.count({
    where: { operatorId, id: { in: pointIds } },
  });
  if (mine !== new Set(pointIds).size) {
    throw new ContentError("One of those points is not in this network");
  }
}

function toData(input: Partial<ContentInput>): Prisma.MarketingContentUncheckedUpdateInput {
  const data: Prisma.MarketingContentUncheckedUpdateInput = {};
  if (input.type !== undefined) data.type = input.type;
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.body !== undefined) data.body = input.body?.trim() || null;
  if (input.linkUrl !== undefined) data.linkUrl = input.linkUrl?.trim() || null;
  if (input.placements !== undefined) data.placements = input.placements;
  if (input.audience !== undefined) data.audience = input.audience;
  if (input.pointIds !== undefined) data.pointIds = input.pointIds;
  if (input.zoneId !== undefined) data.zoneId = input.zoneId;
  if (input.radiusKm !== undefined) data.radiusKm = input.radiusKm;
  if (input.startsAt !== undefined) data.startsAt = input.startsAt;
  if (input.endsAt !== undefined) data.endsAt = input.endsAt;
  if (input.weekdays !== undefined) data.weekdays = input.weekdays;
  if (input.hourFrom !== undefined) data.hourFrom = input.hourFrom;
  if (input.hourTo !== undefined) data.hourTo = input.hourTo;
  return data;
}

/**
 * Open a draft. Like the point wizard (§29.2), the row exists before the first
 * file arrives: an upload that fails must not take the typed text with it.
 */
export async function createContent(
  operatorId: string,
  userId: string,
  input: ContentInput,
) {
  await requireNetwork(operatorId, userId);
  if (!input.title?.trim()) throw new ContentError("Content needs a title");
  validatePlacements(input.placements ?? []);
  validateSchedule(input);
  await validatePoints(operatorId, input.pointIds ?? []);

  return prisma.marketingContent.create({
    data: {
      operatorId,
      type: input.type,
      title: input.title.trim(),
      body: input.body?.trim() || null,
      linkUrl: input.linkUrl?.trim() || null,
      placements: input.placements ?? [],
      audience: input.audience ?? "ALL",
      pointIds: input.pointIds ?? [],
      zoneId: input.zoneId ?? null,
      radiusKm: input.radiusKm ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      weekdays: input.weekdays ?? [],
      hourFrom: input.hourFrom ?? null,
      hourTo: input.hourTo ?? null,
    },
  });
}

/** Editing an approved piece sends it back to the queue: §41 moderates text. */
export async function updateContent(
  contentId: string,
  userId: string,
  input: Partial<ContentInput>,
) {
  const content = await requireOwnedContent(contentId, userId);
  validatePlacements(input.placements ?? []);
  validateSchedule({ ...input, weekdays: input.weekdays ?? [] });
  await validatePoints(content.operatorId, input.pointIds ?? []);

  return prisma.marketingContent.update({
    where: { id: contentId },
    data: { ...toData(input), status: "DRAFT", reviewNote: null, submittedAt: null },
  });
}

/** How many files each kind of content may carry, and of what sort. */
function assetRules(type: MarketingContentType): { max: number; wantsVideo: boolean } {
  switch (type) {
    case "BANNER":
      return { max: 1, wantsVideo: false };
    case "VIDEO":
      return { max: 1, wantsVideo: true };
    case "GALLERY":
      return { max: MAX_GALLERY_ASSETS, wantsVideo: false };
    default:
      // A promotion, a news line or a link may have a picture, or none.
      return { max: 1, wantsVideo: false };
  }
}

export async function attachAsset(contentId: string, userId: string, bytes: Buffer) {
  const content = await requireOwnedContent(contentId, userId);
  const rules = assetRules(content.type);

  if (content.assets.length >= rules.max) {
    throw new ContentError(
      rules.max === 1
        ? "This content carries one file only"
        : `A gallery carries up to ten pictures`,
    );
  }

  const saved = await saveMedia({ operatorId: content.operatorId, bytes });
  if (rules.wantsVideo !== isVideo(saved.mime)) {
    await deleteMedia(saved.storageKey);
    throw new ContentError(
      rules.wantsVideo ? "This content takes a video" : "This content takes an image",
    );
  }

  return prisma.marketingAsset.create({
    data: {
      contentId,
      storageKey: saved.storageKey,
      contentType: saved.mime,
      sizeBytes: saved.sizeBytes,
      durationMs: saved.durationMs,
      position: content.assets.length,
    },
  });
}

export async function detachAsset(assetId: string, userId: string): Promise<void> {
  const asset = await prisma.marketingAsset.findUnique({
    where: { id: assetId },
    include: { content: { include: { operator: { select: { claimedById: true } } } } },
  });
  if (!asset) throw new ContentError("No such file");
  if (asset.content.operator.claimedById !== userId) {
    throw new ContentError("This content belongs to somebody else");
  }
  await prisma.marketingAsset.delete({ where: { id: assetId } });
  await deleteMedia(asset.storageKey);
}

/** What makes a piece complete enough to put in front of a moderator. */
function missingForReview(content: {
  type: MarketingContentType;
  body: string | null;
  linkUrl: string | null;
  assets: unknown[];
}): string | null {
  switch (content.type) {
    case "BANNER":
      return content.assets.length === 0 ? "A banner needs its picture" : null;
    case "VIDEO":
      return content.assets.length === 0 ? "A video needs its file" : null;
    case "GALLERY":
      return content.assets.length === 0 ? "A gallery needs at least one picture" : null;
    case "LINK":
      return content.linkUrl ? null : "A link needs the address it leads to";
    case "PROMO":
      // §41 — "акция с условиями". A promotion without its conditions written
      // out is the misleading advertising the same paragraph forbids.
      return content.body ? null : "A promotion needs its conditions written out";
    case "NEWS":
      return content.body ? null : "A news item needs its text";
    default:
      return null;
  }
}

/** US-40 — "отправка на модерацию". */
export async function submitForReview(contentId: string, userId: string) {
  const content = await requireOwnedContent(contentId, userId);
  if (content.status === "REVIEW") return content;

  const missing = missingForReview(content);
  if (missing) throw new ContentError(missing);

  return prisma.marketingContent.update({
    where: { id: contentId },
    data: { status: "REVIEW", submittedAt: new Date(), reviewNote: null },
  });
}

/** §41 — the Poolwatt operator's decision, and only theirs. */
export async function decideContent(
  contentId: string,
  reviewerId: string,
  approved: boolean,
  note: string | null,
) {
  const reviewer = await prisma.user.findUnique({
    where: { id: reviewerId },
    select: { role: true },
  });
  if (reviewer?.role !== "ADMIN") throw new ContentError("Operators only");

  const content = await prisma.marketingContent.findUnique({ where: { id: contentId } });
  if (!content) throw new ContentError("No such content");
  if (content.status !== "REVIEW") throw new ContentError("This content is not in review");

  return prisma.marketingContent.update({
    where: { id: contentId },
    data: {
      status: approved ? "APPROVED" : "REJECTED",
      reviewedAt: new Date(),
      reviewedById: reviewerId,
      reviewNote: note?.trim() || null,
    },
  });
}

export async function deleteContent(contentId: string, userId: string): Promise<void> {
  const content = await requireOwnedContent(contentId, userId);
  for (const asset of content.assets) await deleteMedia(asset.storageKey);
  await prisma.marketingContent.delete({ where: { id: contentId } });
}

const DISPLAY_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  linkUrl: true,
  status: true,
  placements: true,
  audience: true,
  pointIds: true,
  startsAt: true,
  endsAt: true,
  weekdays: true,
  hourFrom: true,
  hourTo: true,
  assets: {
    select: { id: true, contentType: true, durationMs: true, position: true },
    orderBy: { position: "asc" },
  },
} as const;

/** The cabinet list: everything of this network, whatever its status. */
export async function readNetworkContent(operatorId: string, userId: string) {
  await requireNetwork(operatorId, userId);
  return prisma.marketingContent.findMany({
    where: { operatorId },
    orderBy: { createdAt: "desc" },
    include: { assets: { orderBy: { position: "asc" } } },
  });
}

/** The operator's queue — §41 moderation. */
export async function readReviewQueue(take = 100) {
  return prisma.marketingContent.findMany({
    where: { status: "REVIEW" },
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    take,
    include: {
      assets: { orderBy: { position: "asc" } },
      operator: { select: { id: true, displayName: true } },
    },
  });
}

/**
 * §41 "Таргетинг" needs facts about the viewer. A guest is a newcomer who has
 * charged nowhere — which is true, and makes the public point card work
 * without a session.
 */
export async function readViewerFacts(
  userId: string | null,
  operatorId: string,
): Promise<ViewerFacts> {
  if (!userId) {
    return { signedIn: false, chargesInNetwork: 0, coopMember: false, cardHolder: false };
  }

  const [chargesInNetwork, coopMember] = await Promise.all([
    prisma.payment.count({
      where: {
        wallet: { ownerUserId: userId },
        status: "CAPTURED",
        point: { operatorId },
      },
    }),
    prisma.coopMember.count({ where: { userId, status: "ACTIVE" } }),
  ]);

  return {
    signedIn: true,
    chargesInNetwork,
    coopMember: coopMember > 0,
    // §19 waits for the EMI; nobody holds a Poolwatt card yet.
    cardHolder: false,
  };
}

function forDisplay(row: {
  id: string;
  type: MarketingContentType;
  title: string;
  body: string | null;
  linkUrl: string | null;
  status: ContentForDisplay["status"];
  placements: string[];
  audience: MarketingAudience;
  pointIds: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  weekdays: number[];
  hourFrom: number | null;
  hourTo: number | null;
  assets: { id: string; contentType: string; durationMs: number | null; position: number }[];
}): ContentForDisplay {
  return row;
}

/**
 * What to show at one point, in one place, to one viewer. The point decides
 * the network; `visibility.ts` decides the rest.
 */
export async function readLiveContent(
  pointId: string,
  placement: Placement,
  userId: string | null,
  now: Date = new Date(),
): Promise<ContentForDisplay[]> {
  const point = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    select: { id: true, operatorId: true },
  });
  if (!point) return [];

  const [rows, viewer] = await Promise.all([
    prisma.marketingContent.findMany({
      where: { operatorId: point.operatorId, status: "APPROVED" },
      select: DISPLAY_SELECT,
    }),
    readViewerFacts(userId, point.operatorId),
  ]);

  return selectForPlacement(rows.map(forDisplay), placement, now, viewer, point.id);
}

export type FetchAssetResult =
  | { status: "ok"; bytes: Buffer; mime: string; isPublic: boolean }
  | { status: "not-found" };

/**
 * The bytes of one file, if this viewer may have them.
 *
 * Approved content inside its schedule is public: it is printed on a point
 * card anybody can open. Everything else is visible only to the partner who
 * uploaded it — that is US-40's "предпросмотр" — and to the Poolwatt operator
 * who has to look at it before approving.
 */
export async function fetchAsset(args: {
  assetId: string;
  userId: string | null;
  isAdmin: boolean;
  now?: Date;
}): Promise<FetchAssetResult> {
  const asset = await prisma.marketingAsset.findUnique({
    where: { id: args.assetId },
    include: { content: { select: { ...DISPLAY_SELECT, operator: { select: { claimedById: true } } } } },
  });
  if (!asset) return { status: "not-found" };

  const live = isContentLive(forDisplay(asset.content), args.now ?? new Date());
  const isOwner = args.userId != null && asset.content.operator.claimedById === args.userId;
  if (!live && !isOwner && !args.isAdmin) return { status: "not-found" };

  const file = await readMedia(asset.storageKey);
  if (!file) return { status: "not-found" };
  // The stored type is what the bytes were when they arrived; re-sniffing on
  // the way out means a file swapped on disk cannot change its own type.
  return { status: "ok", bytes: file.bytes, mime: asset.contentType, isPublic: live };
}
