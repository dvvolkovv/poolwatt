// Which gift goes into which session — ТЗ §42 ("Подарок" and "Ограничения").
//
// Pure arithmetic on purpose: the database half (`grant-spend.ts`) locks rows
// and burns batches, and that is hard to reason about. What a gift is *worth*
// in a session is a rule, and a rule can be read and tested on its own.
//
// Three kinds of gift live here:
//   a fixed number of kWh — worth whatever is left of it;
//   a discount of N % — worth N % of this session, never more than the
//     ceiling the partner reserved out of the campaign budget;
//   a free booking — worth no energy at all, and spent in §33, not here.

import { floorKwh, isKwhDust, roundKwh } from "@/lib/exchange/precision";

export interface GiftCandidate {
  id: string;
  campaignId: string;
  kind: "ENERGY" | "FREE_BOOKING";
  /** `amountKwh - usedKwh`: for a discount this is the reserved ceiling. */
  remainingKwh: number;
  /** §42 "скидка в % на следующую зарядку". Null for a fixed gift. */
  discountPct: number | null;
  /** §42 "минимальный объём следующей зарядки". */
  minNextChargeKwh: number | null;
  /** §42 "не суммируется с другими акциями". */
  exclusive: boolean;
  expiresAt: Date;
  issuedAt: Date;
}

/**
 * How many kWh this gift may put into a session of `sessionKwh`.
 *
 * Floored to 0.001 kWh: spending burns whole batches of that size, and a gift
 * must never promise more than it can hand over.
 */
export function giftShare(gift: GiftCandidate, sessionKwh: number): number {
  if (gift.kind !== "ENERGY") return 0;

  const session = roundKwh(Math.max(0, sessionKwh));
  if (isKwhDust(session)) return 0;

  // §42 "минимальный объём следующей зарядки" — the gift is simply not part
  // of a session that small.
  if (gift.minNextChargeKwh != null && session < roundKwh(gift.minNextChargeKwh)) return 0;

  const left = roundKwh(Math.max(0, gift.remainingKwh));
  if (isKwhDust(left)) return 0;

  const ceiling =
    gift.discountPct != null ? floorKwh((session * Math.max(0, gift.discountPct)) / 100) : session;

  const share = floorKwh(Math.min(left, ceiling));
  return isKwhDust(share) ? 0 : share;
}

/**
 * The gifts a session uses, in the order they are spent.
 *
 * Soonest to burn goes first (§43 — a gift that expires tomorrow is worth
 * less than one that expires in a month), and the list stops once the session
 * is covered.
 *
 * §42 "не суммируется с другими акциями": if any of the gifts on the table
 * says that, the session uses exactly one — the one worth most to the driver
 * here, whether or not it is the exclusive one. Keeping the exclusive gift
 * when a plain one gives more would make the rule cost the driver energy,
 * and the rule is about not stacking, not about choosing worse.
 */
export function chooseGifts(candidates: GiftCandidate[], sessionKwh: number): GiftCandidate[] {
  const usable = candidates
    .map((gift) => ({ gift, share: giftShare(gift, sessionKwh) }))
    .filter((row) => !isKwhDust(row.share));
  if (usable.length === 0) return [];

  if (usable.some((row) => row.gift.exclusive)) {
    const best = [...usable].sort(
      (a, b) =>
        b.share - a.share ||
        a.gift.expiresAt.getTime() - b.gift.expiresAt.getTime() ||
        a.gift.issuedAt.getTime() - b.gift.issuedAt.getTime() ||
        a.gift.id.localeCompare(b.gift.id),
    )[0];
    return [best.gift];
  }

  const byExpiry = [...usable].sort(
    (a, b) =>
      a.gift.expiresAt.getTime() - b.gift.expiresAt.getTime() ||
      a.gift.issuedAt.getTime() - b.gift.issuedAt.getTime() ||
      a.gift.id.localeCompare(b.gift.id),
  );

  const picked: GiftCandidate[] = [];
  let left = roundKwh(Math.max(0, sessionKwh));
  for (const row of byExpiry) {
    if (isKwhDust(left)) break;
    picked.push(row.gift);
    left = roundKwh(left - Math.min(row.share, left));
  }
  return picked;
}

/** The kWh a session may take off gifts in total, before anything moves. */
export function totalGiftKwh(candidates: GiftCandidate[], sessionKwh: number): number {
  const chosen = chooseGifts(candidates, sessionKwh);
  let left = roundKwh(Math.max(0, sessionKwh));
  let total = 0;
  for (const gift of chosen) {
    const take = Math.min(giftShare(gift, sessionKwh), left);
    total = roundKwh(total + take);
    left = roundKwh(left - take);
  }
  return total;
}
