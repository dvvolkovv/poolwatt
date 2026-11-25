// §20 decides what a phone shows. The bottom bar holds five slots at most —
// more than that and the targets stop being thumb-sized — so everything that
// is not a tab lives behind the "more" hub (§22 screens 4, 5, 6, 7, 8, 10).

import type { UserStatus } from "@/lib/exchange/user-status";

export type MobileTab = "home" | "wallet" | "charge" | "more" | "profile";

export type MobileSection =
  | "station"
  | "coop"
  | "account"
  | "card"
  | "contacts"
  | "roaming";

export interface ShellCapabilities {
  status: UserStatus;
  hasAsset: boolean;
  isCoopMember: boolean;
}

/** §20: a guest gets "карта зарядных станций, цены, регистрация" and no wallet. */
export function visibleTabs(status: UserStatus): MobileTab[] {
  if (status === "GUEST") return ["home", "charge", "profile"];
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
 * and for a prosumer that is their own station (§22.6). A cooperative member
 * who also produces keeps both entries — `readUserStatus` collapses the two
 * into one badge, which is why the flags travel separately.
 */
export function moreSections(caps: ShellCapabilities): MobileSection[] {
  if (caps.status === "GUEST") return [];
  const sections: MobileSection[] = [];
  if (caps.hasAsset) sections.push("station");
  if (caps.isCoopMember) sections.push("coop");
  sections.push("account", "card", "contacts", "roaming");
  return sections;
}

export const SECTION_HREF: Record<MobileSection, string> = {
  station: "/station",
  coop: "/coop",
  account: "/account",
  card: "/card",
  contacts: "/contacts",
  roaming: "/roaming",
};
