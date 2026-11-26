// §20 decides what a phone shows. The bottom bar holds five slots at most —
// more than that and the targets stop being thumb-sized — so everything that
// is not a tab lives behind the "more" hub (§22 screens 4, 5, 6, 7, 8, 10).
//
// The line that matters for the bar is "signed in or not", not the §20 tier.
// §20 calls an account without KYC a guest, but there is no KYC provider yet
// (§26) and the platform already lets any signed-in account hold a kWh wallet
// and buy (US-07). Hiding the wallet behind a verification nobody can pass
// would leave the app with three working screens. The tier still decides the
// badge and which sections the hub lists.

export type MobileTab = "home" | "wallet" | "charge" | "more" | "profile";

export type MobileSection =
  | "station"
  | "coop"
  | "bookings"
  | "account"
  | "card"
  | "contacts"
  | "roaming";

export interface ShellCapabilities {
  signedIn: boolean;
  hasAsset: boolean;
  isCoopMember: boolean;
}

/** A visitor gets §20's "карта зарядных станций, цены, регистрация". */
export function visibleTabs(signedIn: boolean): MobileTab[] {
  if (!signedIn) return ["home", "charge", "profile"];
  return ["home", "wallet", "charge", "more", "profile"];
}

export const TAB_HREF: Record<MobileTab, string> = {
  home: "",
  wallet: "/wallet",
  charge: "/charge",
  more: "/more",
  profile: "/profile",
};

/**
 * The hub. Order matters: the section a person opens most often comes first,
 * and for a prosumer that is their own station (§22.6). An account that both
 * produces and holds shares keeps both entries — `readUserStatus` collapses
 * the two into one badge, which is why the flags travel separately.
 */
export function moreSections(caps: ShellCapabilities): MobileSection[] {
  if (!caps.signedIn) return [];
  const sections: MobileSection[] = [];
  if (caps.hasAsset) sections.push("station");
  if (caps.isCoopMember) sections.push("coop");
  // Брони идут до счёта и карты: ими пользуются сегодня, а счёт и карта
  // ждут EMI.
  sections.push("bookings", "account", "card", "contacts", "roaming");
  return sections;
}

export const SECTION_HREF: Record<MobileSection, string> = {
  station: "/station",
  coop: "/coop",
  bookings: "/bookings",
  account: "/account",
  card: "/card",
  contacts: "/contacts",
  roaming: "/roaming",
};
