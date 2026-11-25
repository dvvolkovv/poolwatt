// When a piece of partner content may be shown, and to whom — ТЗ §41
// "Расписание", "Таргетинг", "Где показывается".
//
// Pure: the caller hands in the content, the moment and what it knows about
// the viewer, and gets back what to render. Everything that needs the database
// (how many times this person charged in this network, whether they are in the
// cooperative) is gathered by `content-service.readViewerFacts` and arrives
// here as plain facts.

import type { MarketingAudience, MarketingContentType, MarketingStatus } from "@prisma/client";

/** §41 "Где показывается". */
export type Placement = "FULL_CARD" | "NAVIGATOR_MINI" | "CHARGE_COMPLETE" | "PUSH";

export const PLACEMENTS: Placement[] = [
  "FULL_CARD",
  "NAVIGATOR_MINI",
  "CHARGE_COMPLETE",
  "PUSH",
];

export interface DisplayAsset {
  id: string;
  contentType: string;
  durationMs: number | null;
  position: number;
}

/** Everything the display side of §41 needs about one piece of content. */
export interface ContentForDisplay {
  id: string;
  type: MarketingContentType;
  title: string;
  body: string | null;
  linkUrl: string | null;
  status: MarketingStatus;
  placements: string[];
  audience: MarketingAudience;
  pointIds: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  weekdays: number[];
  hourFrom: number | null;
  hourTo: number | null;
  assets: DisplayAsset[];
}

export interface ViewerFacts {
  signedIn: boolean;
  /** Captured charges this person has had at the points of this network. */
  chargesInNetwork: number;
  coopMember: boolean;
  /**
   * Whether they hold a white label card. Always false today: §19 waits for
   * the EMI. Kept as a fact so the day it becomes true nothing else moves.
   */
  cardHolder: boolean;
}

/** §41 "постоянные клиенты сети" — from the third charge in the network. */
export const REGULAR_FROM_CHARGES = 3;

/**
 * Is this content live right now?
 *
 * The hour and weekday are read in UTC. A per-point local time would be
 * better, but `AcceptancePoint` carries a country, not a timezone, and
 * guessing one from the country would be wrong in half of them — so the
 * schedule means UTC, and the cabinet says so.
 */
export function isContentLive(content: ContentForDisplay, now: Date): boolean {
  if (content.status !== "APPROVED") return false;
  if (content.startsAt && now < content.startsAt) return false;
  if (content.endsAt && now > content.endsAt) return false;

  if (content.weekdays.length > 0 && !content.weekdays.includes(now.getUTCDay())) {
    return false;
  }

  const { hourFrom, hourTo } = content;
  if (hourFrom != null && hourTo != null && hourFrom !== hourTo) {
    const hour = now.getUTCHours();
    // Half-open [from, to). A window whose end is before its start crosses
    // midnight: 22 → 6 means the evening and the small hours, not nothing.
    const inside =
      hourFrom < hourTo ? hour >= hourFrom && hour < hourTo : hour >= hourFrom || hour < hourTo;
    if (!inside) return false;
  }

  return true;
}

/** §41 "Таргетинг". */
export function matchesAudience(content: ContentForDisplay, viewer: ViewerFacts): boolean {
  switch (content.audience) {
    case "ALL":
      return true;
    case "NEWCOMERS":
      // A guest has not charged here either, and the point card is public.
      return viewer.chargesInNetwork === 0;
    case "REGULARS":
      return viewer.chargesInNetwork >= REGULAR_FROM_CHARGES;
    case "COOP_MEMBERS":
      return viewer.coopMember;
    case "CARD_HOLDERS":
      // Nobody. Poolwatt white label cards do not exist (§19 waits for the
      // EMI), and an offer for holders of a card nobody can have is exactly
      // the misleading advertising §41 forbids.
      return false;
    default:
      return false;
  }
}

/** §41 — a banner is the only thing the navigator's mini-card has room for. */
const TYPE_ORDER: MarketingContentType[] = ["BANNER", "VIDEO", "PROMO", "GALLERY", "NEWS", "LINK"];

/**
 * What to show in one place. `pointId` narrows network-wide content down to
 * the point being looked at; omit it when the place is not a point (the
 * charge-complete screen of a session already knows its point).
 */
export function selectForPlacement(
  contents: ContentForDisplay[],
  placement: Placement,
  now: Date,
  viewer: ViewerFacts,
  pointId?: string | null,
): ContentForDisplay[] {
  return contents
    .filter((c) => c.placements.includes(placement))
    .filter((c) => c.pointIds.length === 0 || (pointId != null && c.pointIds.includes(pointId)))
    .filter((c) => isContentLive(c, now))
    .filter((c) => matchesAudience(c, viewer))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
}
