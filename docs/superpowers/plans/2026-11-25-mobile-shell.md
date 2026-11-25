# Mobile App Shell (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-shaped section of the site at `/{locale}/app` with a bottom
tab bar, §20 status awareness, an installable manifest, an offline screen that
still shows the last known balance, and both native shells (Android now, iOS
next) pointed at it.

**Architecture:** `src/app/[locale]/app/` is a nested layout inside the
existing locale layout. The site navbar and footer hide themselves on those
routes through a client gate that reads `usePathname()`, so nothing has to
move. The layout reads the §20 status once and passes it down; pure functions
in `src/lib/mobile/` decide which tabs and sections a status may see, so the
rules are unit-testable without a browser. A service worker caches the shell
and falls back to `/app/offline`, which reads the last balance written to
`localStorage` by the home screen.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl v4, Tailwind v4,
Prisma, Vitest, Playwright (Pixel 7 device project), Capacitor 7.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/mobile/tabs.ts` | which of the five tabs a §20 status sees; which sections `/app/more` lists |
| `src/lib/mobile/tabs.test.ts` | unit tests for the above |
| `src/lib/mobile/shell-context.ts` | `readShellContext(userId)` — status, hasAsset, isCoopMember, home zone, balances |
| `src/components/mobile/chrome-gate.tsx` | client gate that hides the site navbar and footer under `/app` |
| `src/components/mobile/tab-bar.tsx` | the bottom bar, active tab from `usePathname()` |
| `src/components/mobile/balance-cache.tsx` | writes the last balance snapshot to `localStorage` |
| `src/components/mobile/sw-register.tsx` | registers `/sw.js` |
| `src/components/mobile/screen.tsx` | `<Screen title>` — the common header + padding of every screen |
| `src/components/mobile/soon.tsx` | honest placeholder naming the milestone a screen arrives in |
| `src/app/[locale]/app/layout.tsx` | mobile shell: viewport, manifest, status context, tab bar |
| `src/app/[locale]/app/page.tsx` | §22.2 main screen |
| `src/app/[locale]/app/more/page.tsx` | hub for the screens that are not tabs |
| `src/app/[locale]/app/offline/page.tsx` | §25 offline screen |
| `src/app/[locale]/app/{wallet,charge,profile,station,coop,account,card,contacts,roaming,onboarding}/page.tsx` | placeholders for M2–M6 |
| `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`, `public/sw.js` | PWA |
| `messages/{en,ru,sk}.json` | `app.*` namespace |
| `tests/e2e/mobile-shell.mobile.spec.ts` | Pixel 7 run over the shell |

---

## Task 1: Tab and section rules

**Files:**
- Create: `src/lib/mobile/tabs.ts`
- Test: `src/lib/mobile/tabs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/mobile/tabs.test.ts
import { describe, it, expect } from "vitest";
import { visibleTabs, moreSections } from "./tabs";

describe("visibleTabs — §20", () => {
  it("shows a guest only the map, the main screen and the profile", () => {
    expect(visibleTabs("GUEST")).toEqual(["home", "charge", "profile"]);
  });

  it("gives a consumer the wallet and the hub", () => {
    expect(visibleTabs("CONSUMER")).toEqual([
      "home", "wallet", "charge", "more", "profile",
    ]);
  });

  it("never offers more than five tabs", () => {
    for (const status of ["GUEST", "CONSUMER", "PROSUMER", "COOP_MEMBER"] as const) {
      expect(visibleTabs(status).length).toBeLessThanOrEqual(5);
    }
  });
});

describe("moreSections — §22", () => {
  it("offers a guest nothing: every section needs KYC", () => {
    expect(
      moreSections({ status: "GUEST", hasAsset: false, isCoopMember: false }),
    ).toEqual([]);
  });

  it("offers a consumer the account, the card, contacts and roaming", () => {
    expect(
      moreSections({ status: "CONSUMER", hasAsset: false, isCoopMember: false }),
    ).toEqual(["account", "card", "contacts", "roaming"]);
  });

  it("puts the station first for a prosumer", () => {
    expect(
      moreSections({ status: "PROSUMER", hasAsset: true, isCoopMember: false })[0],
    ).toBe("station");
  });

  it("keeps both the station and the cooperative for a member who produces", () => {
    const sections = moreSections({
      status: "COOP_MEMBER", hasAsset: true, isCoopMember: true,
    });
    expect(sections).toContain("station");
    expect(sections).toContain("coop");
  });

  it("gives a member without a station no station section", () => {
    expect(
      moreSections({ status: "COOP_MEMBER", hasAsset: false, isCoopMember: true }),
    ).not.toContain("station");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/poolwatt
NODE_ENV=test npx vitest run src/lib/mobile/tabs.test.ts
```

Expected: `Failed to resolve import "./tabs"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/mobile/tabs.ts
// §20 decides what a phone shows. The bottom bar holds five slots at most —
// more than that and the targets stop being thumb-sized — so everything that
// is not a tab lives behind the "more" hub (§22 screens 4, 5, 6, 7, 8, 10).

import type { UserStatus } from "@/lib/exchange/user-status";

export type MobileTab = "home" | "wallet" | "charge" | "more" | "profile";

export type MobileSection =
  | "station" | "coop" | "account" | "card" | "contacts" | "roaming";

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
 * and for a prosumer that is their own station (§22.6).
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
```

- [ ] **Step 4: Run it and watch it pass**

```bash
NODE_ENV=test npx vitest run src/lib/mobile/tabs.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mobile/tabs.ts src/lib/mobile/tabs.test.ts
git commit -m "feat(mobile): the §20 rules behind the bottom bar"
```

---

## Task 2: Shell context

**Files:**
- Create: `src/lib/mobile/shell-context.ts`

No test of its own: it is three Prisma reads and a call into
`readUserStatus`, which `user-status.test.ts` already covers. The e2e run in
Task 9 is what proves it wired up.

- [ ] **Step 1: Write it**

```ts
// src/lib/mobile/shell-context.ts
// Everything the mobile shell needs to draw itself, in one round-trip: the
// §20 badge, the two capability flags the hub reads, and the balances the
// main screen shows big (§22.2).

import { CoopMemberStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { readUserStatus, type UserStatus } from "@/lib/exchange/user-status";
import { readWallets, type WalletView } from "@/lib/exchange/wallet-service";

export interface ShellContext {
  status: UserStatus;
  hasAsset: boolean;
  isCoopMember: boolean;
  wallets: WalletView[];
  totalKwh: number;
  /** The wallet whose zone the person charges in most — the one shown big. */
  primary: WalletView | null;
}

export async function readShellContext(userId: string): Promise<ShellContext> {
  const [status, asset, member, wallets] = await Promise.all([
    readUserStatus(userId),
    prisma.asset.findFirst({
      where: { company: { ownerUserId: userId } },
      select: { id: true },
    }),
    prisma.coopMember.findFirst({
      where: { userId, status: CoopMemberStatus.ACTIVE, shares: { gt: 0 } },
      select: { id: true },
    }),
    readWallets(userId),
  ]);

  const totalKwh = wallets.reduce((sum, w) => sum + w.kwhBalance, 0);
  const primary =
    wallets.slice().sort((a, b) => b.kwhBalance - a.kwhBalance)[0] ?? null;

  return {
    status,
    hasAsset: Boolean(asset),
    isCoopMember: Boolean(member),
    wallets,
    totalKwh: num(totalKwh),
    primary,
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. If `num` rejects a plain number, drop the call and
return `totalKwh` as is — the figure is formatted at render time.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mobile/shell-context.ts
git commit -m "feat(mobile): one read for the shell — status, flags, balances"
```

---

## Task 3: Hide the desktop chrome under /app

**Files:**
- Create: `src/components/mobile/chrome-gate.tsx`
- Modify: `src/app/[locale]/layout.tsx`

- [ ] **Step 1: Write the gate**

```tsx
// src/components/mobile/chrome-gate.tsx
"use client";

import { usePathname } from "next/navigation";

/**
 * The site header and footer are built for a monitor: a 1600-pixel row and a
 * link farm. Under /{locale}/app the phone shell draws its own chrome, so this
 * gate swallows them. Keeping the check here, rather than splitting the route
 * tree into two root layouts, leaves every existing page untouched.
 */
export function ChromeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (/^\/[A-Za-z-]+\/app(\/|$)/.test(pathname ?? "")) return null;
  return <>{children}</>;
}
```

- [ ] **Step 2: Wire it into the locale layout**

Replace the returned tree in `src/app/[locale]/layout.tsx` with:

```tsx
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div className="min-h-screen flex flex-col">
        <ChromeGate>
          <Navbar />
        </ChromeGate>
        <div className="flex-1">{children}</div>
        <ChromeGate>
          <Footer />
        </ChromeGate>
      </div>
    </NextIntlClientProvider>
  );
```

and add the import `import { ChromeGate } from "@/components/mobile/chrome-gate";`.

- [ ] **Step 3: Commit**

```bash
git add src/components/mobile/chrome-gate.tsx src/app/\[locale\]/layout.tsx
git commit -m "feat(mobile): the site chrome steps aside under /app"
```

---

## Task 4: Translations

**Files:**
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

- [ ] **Step 1: Add the `app` namespace to `messages/en.json`**

Insert at the top level (the file is one JSON object; keep the existing keys):

```json
  "app": {
    "tabs": {
      "home": "Home",
      "wallet": "Wallet",
      "charge": "Charge",
      "more": "More",
      "profile": "Profile"
    },
    "status": {
      "GUEST": "Guest",
      "CONSUMER": "Consumer",
      "PROSUMER": "Prosumer",
      "COOP_MEMBER": "Cooperative member"
    },
    "home": {
      "balance": "Energy balance",
      "money": "Money",
      "zonePrice": "Price in {zone}",
      "buy": "Buy",
      "transfer": "Transfer",
      "charge": "Charge",
      "topUp": "Top up",
      "guestTitle": "Charge anywhere",
      "guestBody": "See the stations and prices around you. Sign up to pay with kWh.",
      "signUp": "Sign up",
      "signIn": "Sign in"
    },
    "sections": {
      "station": "My station",
      "coop": "Cooperative",
      "account": "Account",
      "card": "Card",
      "contacts": "Contacts and transfers",
      "roaming": "Roaming"
    },
    "soon": {
      "title": "Not here yet",
      "body": "This screen arrives in stage {stage}.",
      "back": "Back"
    },
    "offline": {
      "title": "No connection",
      "body": "This is the last balance this phone saw, at {at}.",
      "retry": "Try again",
      "stale": "The figure may be out of date."
    },
    "install": {
      "title": "Poolwatt",
      "short": "Poolwatt"
    }
  },
```

- [ ] **Step 2: Translate into `messages/ru.json`**

```json
  "app": {
    "tabs": {
      "home": "Главная",
      "wallet": "Кошелёк",
      "charge": "Зарядка",
      "more": "Моё",
      "profile": "Профиль"
    },
    "status": {
      "GUEST": "Гость",
      "CONSUMER": "Потребитель",
      "PROSUMER": "Просьюмер",
      "COOP_MEMBER": "Член кооператива"
    },
    "home": {
      "balance": "Баланс кВт·ч",
      "money": "Деньги",
      "zonePrice": "Цена в зоне {zone}",
      "buy": "Купить",
      "transfer": "Перевести",
      "charge": "Зарядиться",
      "topUp": "Пополнить",
      "guestTitle": "Зарядка где угодно",
      "guestBody": "Смотрите станции и цены рядом. Зарегистрируйтесь, чтобы платить киловатт-часами.",
      "signUp": "Регистрация",
      "signIn": "Вход"
    },
    "sections": {
      "station": "Моя станция",
      "coop": "Кооператив",
      "account": "Счёт",
      "card": "Карта",
      "contacts": "Контакты и переводы",
      "roaming": "Роуминг"
    },
    "soon": {
      "title": "Экрана ещё нет",
      "body": "Он появится на этапе {stage}.",
      "back": "Назад"
    },
    "offline": {
      "title": "Нет связи",
      "body": "Это последний баланс, который видел телефон, в {at}.",
      "retry": "Попробовать снова",
      "stale": "Цифра может быть устаревшей."
    },
    "install": {
      "title": "Poolwatt",
      "short": "Poolwatt"
    }
  },
```

- [ ] **Step 3: Translate into `messages/sk.json`**

```json
  "app": {
    "tabs": {
      "home": "Domov",
      "wallet": "Peňaženka",
      "charge": "Nabíjanie",
      "more": "Moje",
      "profile": "Profil"
    },
    "status": {
      "GUEST": "Hosť",
      "CONSUMER": "Spotrebiteľ",
      "PROSUMER": "Prosumer",
      "COOP_MEMBER": "Člen družstva"
    },
    "home": {
      "balance": "Zostatok kWh",
      "money": "Peniaze",
      "zonePrice": "Cena v zóne {zone}",
      "buy": "Kúpiť",
      "transfer": "Poslať",
      "charge": "Nabiť",
      "topUp": "Dobiť",
      "guestTitle": "Nabíjanie kdekoľvek",
      "guestBody": "Pozrite si stanice a ceny okolo seba. Zaregistrujte sa a plaťte kilowatthodinami.",
      "signUp": "Registrácia",
      "signIn": "Prihlásenie"
    },
    "sections": {
      "station": "Moja stanica",
      "coop": "Družstvo",
      "account": "Účet",
      "card": "Karta",
      "contacts": "Kontakty a prevody",
      "roaming": "Roaming"
    },
    "soon": {
      "title": "Obrazovka ešte nie je",
      "body": "Príde vo fáze {stage}.",
      "back": "Späť"
    },
    "offline": {
      "title": "Bez pripojenia",
      "body": "Toto je posledný zostatok, ktorý telefón videl, o {at}.",
      "retry": "Skúsiť znova",
      "stale": "Číslo môže byť neaktuálne."
    },
    "install": {
      "title": "Poolwatt",
      "short": "Poolwatt"
    }
  },
```

- [ ] **Step 4: Check the three files still parse**

```bash
for f in en ru sk; do node -e "JSON.parse(require('fs').readFileSync('messages/$f.json','utf8'));console.log('$f ok')"; done
```

Expected: `en ok`, `ru ok`, `sk ok`.

- [ ] **Step 5: Commit**

```bash
git add messages/en.json messages/ru.json messages/sk.json
git commit -m "i18n(mobile): the app namespace in en, ru and sk"
```

---

## Task 5: The shell layout and the bottom bar

**Files:**
- Create: `src/components/mobile/tab-bar.tsx`
- Create: `src/components/mobile/screen.tsx`
- Create: `src/app/[locale]/app/layout.tsx`

- [ ] **Step 1: Write the bar**

```tsx
// src/components/mobile/tab-bar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { TAB_HREF, type MobileTab } from "@/lib/mobile/tabs";

/** One glyph per tab. Text fonts only — no icon dependency for a bar of five. */
const GLYPH: Record<MobileTab, string> = {
  home: "⌂",
  wallet: "⚡",
  charge: "⌁",
  more: "⊞",
  profile: "☻",
};

export function TabBar({ tabs, locale }: { tabs: MobileTab[]; locale: string }) {
  const pathname = usePathname() ?? "";
  const t = useTranslations("app.tabs");
  const root = `/${locale}/app`;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-hairline
                 bg-[rgba(12,16,20,0.95)] backdrop-blur-md
                 pb-[env(safe-area-inset-bottom)]"
      aria-label={t("home")}
    >
      <ul className="flex">
        {tabs.map((tab) => {
          const href = `${root}${TAB_HREF[tab]}`;
          const active = tab === "home" ? pathname === root : pathname.startsWith(href);
          return (
            <li key={tab} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                data-tab={tab}
                className={`flex flex-col items-center gap-1 py-2.5 text-[10px]
                            uppercase tracking-[0.12em] transition-colors
                            ${active ? "text-accent" : "text-muted"}`}
              >
                <span aria-hidden className="text-[20px] leading-none">{GLYPH[tab]}</span>
                {t(tab)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 2: Write the screen frame**

```tsx
// src/components/mobile/screen.tsx
import Link from "next/link";

/**
 * Every screen below the main one looks the same: a title row with a way
 * back, then one column. The bottom padding clears the tab bar.
 */
export function Screen({
  title,
  back,
  children,
}: {
  title: string;
  back?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28">
      <header className="flex items-center gap-3 h-12">
        {back && (
          <Link
            href={back}
            aria-label={title}
            className="text-muted text-[20px] leading-none -ml-1 px-1"
          >
            ‹
          </Link>
        )}
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h1>
      </header>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Write the layout**

```tsx
// src/app/[locale]/app/layout.tsx
// §22 — the phone shell. Lives inside the locale layout, so translations and
// the intl provider come for free; the site navbar and footer are swallowed by
// ChromeGate.

import type { Metadata, Viewport } from "next";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { readUserStatus } from "@/lib/exchange/user-status";
import { visibleTabs } from "@/lib/mobile/tabs";
import { TabBar } from "@/components/mobile/tab-bar";
import { SwRegister } from "@/components/mobile/sw-register";

export const metadata: Metadata = {
  title: "Poolwatt",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Poolwatt" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0c1014",
};

export default async function MobileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const status = session?.user ? await readUserStatus(session.user.id) : "GUEST";

  return (
    <div className="min-h-screen bg-bg">
      <SwRegister />
      {children}
      <TabBar tabs={visibleTabs(status)} locale={locale} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/mobile/tab-bar.tsx src/components/mobile/screen.tsx \
  "src/app/[locale]/app/layout.tsx"
git commit -m "feat(mobile): the shell and its bottom bar"
```

---

## Task 6: Service worker, manifest, offline screen

**Files:**
- Create: `public/manifest.webmanifest`, `public/sw.js`, `public/icon-192.png`, `public/icon-512.png`
- Create: `src/components/mobile/sw-register.tsx`
- Create: `src/components/mobile/balance-cache.tsx`
- Create: `src/app/[locale]/app/offline/page.tsx`

- [ ] **Step 1: Make the icons from the existing mark**

```bash
cd ~/poolwatt
mkdir -p public
command -v rsvg-convert >/dev/null && \
  rsvg-convert -w 192 -h 192 src/app/icon.svg -o public/icon-192.png || \
  npx --yes sharp-cli -i src/app/icon.svg -o public/icon-192.png resize 192 192
command -v rsvg-convert >/dev/null && \
  rsvg-convert -w 512 -h 512 src/app/icon.svg -o public/icon-512.png || \
  npx --yes sharp-cli -i src/app/icon.svg -o public/icon-512.png resize 512 512
file public/icon-192.png public/icon-512.png
```

Expected: both reported as `PNG image data, 192 x 192` and `512 x 512`.

- [ ] **Step 2: Write the manifest**

```json
{
  "name": "Poolwatt",
  "short_name": "Poolwatt",
  "start_url": "/en/app",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0c1014",
  "theme_color": "#0c1014",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 3: Write the service worker**

```js
// public/sw.js
// §25 "Офлайн-режим: последний известный баланс и QR для зарядки".
//
// Deliberately small. Money screens must never answer from a cache: a stale
// balance shown as current is worse than an error. So pages are
// network-first with one fallback — the offline screen, which says out loud
// that its figure is the last one seen and when.

const SHELL = "poolwatt-shell-v1";
const OFFLINE = "/en/app/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      cache.addAll([OFFLINE, "/manifest.webmanifest", "/icon-192.png"]),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Static build output never changes under a given URL: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon-")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE).then((hit) => hit ?? Response.error()),
    ),
  );
});
```

- [ ] **Step 4: Write the registration and the balance cache**

```tsx
// src/components/mobile/sw-register.tsx
"use client";

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A phone that refuses the worker still works online; nothing to say.
    });
  }, []);
  return null;
}
```

```tsx
// src/components/mobile/balance-cache.tsx
"use client";

import { useEffect } from "react";

export const BALANCE_CACHE_KEY = "poolwatt.lastBalance";

export interface CachedBalance {
  kwh: number;
  fiat: number;
  currency: string;
  zoneCode: string | null;
  at: string;
}

/**
 * The main screen renders this with the figures it just read. The offline
 * screen is the only reader, and it prints the timestamp next to the number,
 * so a stale value can never pass for a fresh one (§25).
 */
export function BalanceCache(props: Omit<CachedBalance, "at">) {
  useEffect(() => {
    try {
      const payload: CachedBalance = { ...props, at: new Date().toISOString() };
      window.localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Private mode, quota, an old WebView — the figure is a convenience.
    }
  }, [props]);
  return null;
}
```

- [ ] **Step 5: Write the offline screen**

```tsx
// src/app/[locale]/app/offline/page.tsx
import { setRequestLocale } from "next-intl/server";
import { OfflineBalance } from "@/components/mobile/offline-balance";
import { Screen } from "@/components/mobile/screen";
import { getTranslations } from "next-intl/server";

// The service worker serves this page from its cache, so nothing on it may
// touch the session or the database.
export const dynamic = "force-static";

export default async function OfflinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.offline");

  return (
    <Screen title={t("title")}>
      <OfflineBalance
        bodyTemplate={t.raw("body") as string}
        staleLabel={t("stale")}
        retryLabel={t("retry")}
      />
    </Screen>
  );
}
```

```tsx
// src/components/mobile/offline-balance.tsx
"use client";

import { useEffect, useState } from "react";
import { BALANCE_CACHE_KEY, type CachedBalance } from "./balance-cache";

export function OfflineBalance({
  bodyTemplate,
  staleLabel,
  retryLabel,
}: {
  bodyTemplate: string;
  staleLabel: string;
  retryLabel: string;
}) {
  const [cached, setCached] = useState<CachedBalance | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BALANCE_CACHE_KEY);
      if (raw) setCached(JSON.parse(raw) as CachedBalance);
    } catch {
      setCached(null);
    }
  }, []);

  return (
    <div className="mt-6" data-testid="offline-screen">
      {cached ? (
        <>
          <div className="num text-[44px] font-semibold leading-none">
            {cached.kwh.toFixed(2)}
            <span className="text-[16px] text-muted ml-2">kWh</span>
          </div>
          <p className="text-[13px] text-muted mt-3">
            {bodyTemplate.replace("{at}", new Date(cached.at).toLocaleString())}
          </p>
          <p className="text-[13px] text-accent mt-1">{staleLabel}</p>
        </>
      ) : (
        <p className="text-[13px] text-muted">{staleLabel}</p>
      )}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 w-full rounded-md bg-accent text-accent-foreground py-3 font-semibold"
      >
        {retryLabel}
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add public/manifest.webmanifest public/sw.js public/icon-192.png public/icon-512.png \
  src/components/mobile/sw-register.tsx src/components/mobile/balance-cache.tsx \
  src/components/mobile/offline-balance.tsx "src/app/[locale]/app/offline/page.tsx"
git commit -m "feat(mobile): installable, and honest when the network is gone"
```

---

## Task 7: The main screen

**Files:**
- Create: `src/app/[locale]/app/page.tsx`
- Create: `src/components/mobile/quick-actions.tsx`

- [ ] **Step 1: Write the quick actions**

```tsx
// src/components/mobile/quick-actions.tsx
import Link from "next/link";

export interface QuickAction {
  key: string;
  label: string;
  href: string;
  glyph: string;
}

/** §22.2 — "быстрые кнопки: «Купить», «Перевести», «Зарядиться», «Пополнить»". */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="grid grid-cols-4 gap-2 mt-6">
      {actions.map((a) => (
        <Link
          key={a.key}
          href={a.href}
          data-action={a.key}
          className="flex flex-col items-center gap-2 rounded-lg bg-card
                     border border-hairline py-3 text-[11px] text-muted-strong"
        >
          <span aria-hidden className="text-[20px] leading-none text-accent">{a.glyph}</span>
          {a.label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write the screen**

```tsx
// src/app/[locale]/app/page.tsx
// §22.2 "Главный экран" — balance big, money under it, §20 badge, the price
// in the zone, four quick buttons. US-17 asks for a live balance; M2 adds the
// socket, M1 shows the figure the server read.

import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roundPrice } from "@/lib/exchange/precision";
import { readShellContext } from "@/lib/mobile/shell-context";
import { QuickActions } from "@/components/mobile/quick-actions";
import { BalanceCache } from "@/components/mobile/balance-cache";

export const dynamic = "force-dynamic";

export default async function MobileHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.home");
  const tStatus = await getTranslations("app.status");

  const session = await auth();
  const root = `/${locale}/app`;

  if (!session?.user) {
    return (
      <div className="px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-28">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t("guestTitle")}</h1>
        <p className="text-[14px] text-muted mt-2">{t("guestBody")}</p>
        <Link
          href={`/${locale}/register`}
          className="mt-6 block rounded-md bg-accent text-accent-foreground
                     py-3 text-center font-semibold"
        >
          {t("signUp")}
        </Link>
        <Link
          href={`/${locale}/login?callbackUrl=${root}`}
          className="mt-3 block rounded-md border border-hairline py-3 text-center"
        >
          {t("signIn")}
        </Link>
      </div>
    );
  }

  const ctx = await readShellContext(session.user.id);
  const zoneCode = ctx.primary?.zoneCode ?? null;
  const zone = zoneCode
    ? await prisma.gridZone.findUnique({
        where: { code: zoneCode },
        select: { code: true, currency: true, spotPrice: true },
      })
    : null;

  return (
    <div className="px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-28">
      <BalanceCache
        kwh={ctx.totalKwh}
        fiat={ctx.primary?.fiatBalance ?? 0}
        currency={ctx.primary?.currency ?? "EUR"}
        zoneCode={zoneCode}
      />

      <div className="flex items-center justify-between">
        <span
          data-testid="status-badge"
          className="text-[10px] uppercase tracking-[0.18em] text-accent
                     border border-accent/40 rounded-sm px-2 py-0.5"
        >
          {tStatus(ctx.status)}
        </span>
        <Link href={`${root}/profile`} className="text-[13px] text-muted">
          @{session.user.username}
        </Link>
      </div>

      <div className="mt-6">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
          {t("balance")}
        </div>
        <div
          data-testid="kwh-balance"
          className="num text-[52px] font-semibold leading-none mt-1"
        >
          {ctx.totalKwh.toFixed(2)}
          <span className="text-[18px] text-muted ml-2">kWh</span>
        </div>
        <div className="num text-[16px] text-muted-strong mt-3">
          {(ctx.primary?.fiatBalance ?? 0).toFixed(2)} {ctx.primary?.currency ?? "EUR"}
          <span className="text-[13px] text-muted ml-2">{t("money")}</span>
        </div>
      </div>

      {zone?.spotPrice != null && (
        <div className="mt-5 rounded-lg bg-card border border-hairline px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
            {t("zonePrice", { zone: zone.code })}
          </div>
          <div className="num text-[20px] mt-1">
            {roundPrice(Number(zone.spotPrice)).toFixed(4)} {zone.currency}/kWh
          </div>
        </div>
      )}

      <QuickActions
        actions={[
          { key: "buy", label: t("buy"), href: `${root}/wallet`, glyph: "＋" },
          { key: "transfer", label: t("transfer"), href: `${root}/contacts`, glyph: "→" },
          { key: "charge", label: t("charge"), href: `${root}/charge`, glyph: "⌁" },
          { key: "topUp", label: t("topUp"), href: `${root}/account`, glyph: "⇅" },
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 3: Check the zone field name**

```bash
grep -n "spotPrice\|model GridZone" -A 20 prisma/schema.prisma | sed -n '1,40p'
```

If `GridZone` has no `spotPrice` column, read the price the way
`src/app/[locale]/exchange/page.tsx` does and use that call instead; do not
invent a column.

- [ ] **Step 4: Build and look at it**

```bash
cd ~/poolwatt && npm run build && pm2 restart poolwatt-web
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/ru/app
```

Expected: `200`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/app/page.tsx" src/components/mobile/quick-actions.tsx
git commit -m "feat(mobile): the §22.2 main screen"
```

---

## Task 8: The hub and the placeholders

**Files:**
- Create: `src/components/mobile/soon.tsx`
- Create: `src/app/[locale]/app/more/page.tsx`
- Create: `src/app/[locale]/app/{wallet,charge,profile,station,coop,account,card,contacts,roaming,onboarding}/page.tsx`

- [ ] **Step 1: Write the placeholder**

```tsx
// src/components/mobile/soon.tsx
import { getTranslations } from "next-intl/server";

/**
 * A screen that is planned but not built says so, and names the stage. An
 * empty page that looks broken costs more trust than an honest one.
 */
export async function Soon({ stage }: { stage: string }) {
  const t = await getTranslations("app.soon");
  return (
    <div className="mt-10 rounded-lg border border-hairline bg-card px-4 py-6">
      <div className="text-[15px] font-semibold">{t("title")}</div>
      <p className="text-[13px] text-muted mt-2">{t("body", { stage })}</p>
    </div>
  );
}
```

- [ ] **Step 2: Write the hub**

```tsx
// src/app/[locale]/app/more/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { readShellContext } from "@/lib/mobile/shell-context";
import { moreSections, SECTION_HREF } from "@/lib/mobile/tabs";
import { Screen } from "@/components/mobile/screen";

export const dynamic = "force-dynamic";

export default async function MorePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/app/more`);

  const t = await getTranslations("app.tabs");
  const tSections = await getTranslations("app.sections");
  const ctx = await readShellContext(session.user.id);
  const sections = moreSections(ctx);

  return (
    <Screen title={t("more")}>
      <ul className="mt-4 rounded-lg border border-hairline bg-card divide-y divide-[var(--color-hairline)]">
        {sections.map((section) => (
          <li key={section}>
            <Link
              href={`/${locale}/app${SECTION_HREF[section]}`}
              data-section={section}
              className="flex items-center justify-between px-4 py-4 text-[15px]"
            >
              {tSections(section)}
              <span aria-hidden className="text-muted">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
```

- [ ] **Step 3: Write the ten placeholders**

Each file is the same shape. `wallet` (stage M2) shown in full; repeat with
the title key and stage from the table below.

```tsx
// src/app/[locale]/app/wallet/page.tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Screen } from "@/components/mobile/screen";
import { Soon } from "@/components/mobile/soon";

export default async function WalletScreen({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.tabs");
  return (
    <Screen title={t("wallet")}>
      <Soon stage="M2" />
    </Screen>
  );
}
```

| Directory | Title key | Stage |
| --- | --- | --- |
| `wallet` | `app.tabs.wallet` | M2 |
| `charge` | `app.tabs.charge` | M3 |
| `profile` | `app.tabs.profile` | M5 |
| `station` | `app.sections.station` | M5 |
| `coop` | `app.sections.coop` | M5 |
| `account` | `app.sections.account` | M6 |
| `card` | `app.sections.card` | M6 |
| `contacts` | `app.sections.contacts` | M4 |
| `roaming` | `app.sections.roaming` | M3 |
| `onboarding` | `app.sections.account` | M6 |

- [ ] **Step 4: Build**

```bash
cd ~/poolwatt && npm run build && pm2 restart poolwatt-web
for p in "" /wallet /charge /more /profile /offline; do
  printf "%s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/ru/app$p"
done
```

Expected: `200` for every row (`/more` answers `307` when signed out — that
is correct, it redirects to the login page).

- [ ] **Step 5: Commit**

```bash
git add src/components/mobile/soon.tsx "src/app/[locale]/app"
git commit -m "feat(mobile): the hub and honest placeholders for M2-M6"
```

---

## Task 9: Playwright on a phone

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/mobile-shell.mobile.spec.ts`

- [ ] **Step 1: Add the phone project**

In `playwright.config.ts`, change `projects` to:

```ts
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
      testIgnore: /\.mobile\.spec\.ts$/,
    },
    {
      // §22 is a phone screen; a desktop viewport would never show the bar.
      name: "mobile",
      use: { ...devices["Pixel 7"], channel: "chrome" },
      testMatch: /\.mobile\.spec\.ts$/,
    },
  ],
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/e2e/mobile-shell.mobile.spec.ts
// M1 — the shell as a person meets it on a phone: five tabs, no desktop
// chrome, an honest offline screen.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const USER = { username: "e2e_mobile_shell", password: "Pass1234" };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: USER.username } });
  await prisma.user.create({
    data: {
      username: USER.username,
      passwordHash: await bcrypt.hash(USER.password, 10),
    },
  });
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: USER.username } });
  await prisma.$disconnect();
});

test("a guest sees three tabs and no site header", async ({ page }) => {
  await page.goto("/ru/app");
  await expect(page.locator("[data-tab]")).toHaveCount(3);
  await expect(page.locator("[data-tab=wallet]")).toHaveCount(0);
  await expect(page.locator("header a[aria-label]").filter({ hasText: "poolwatt" })).toHaveCount(0);
});

test("a signed-in person gets five tabs, a badge and four quick buttons", async ({ page }) => {
  await signInWithPassword(page, USER.username, USER.password);
  await page.goto("/ru/app");
  await expect(page.locator("[data-tab]")).toHaveCount(5);
  await expect(page.getByTestId("status-badge")).toBeVisible();
  await expect(page.getByTestId("kwh-balance")).toBeVisible();
  for (const action of ["buy", "transfer", "charge", "topUp"]) {
    await expect(page.locator(`[data-action=${action}]`)).toBeVisible();
  }
});

test("the wallet tab leads to the wallet screen", async ({ page }) => {
  await signInWithPassword(page, USER.username, USER.password);
  await page.goto("/ru/app");
  await page.locator("[data-tab=wallet]").click();
  await expect(page).toHaveURL(/\/ru\/app\/wallet$/);
});

test("the offline screen says its figure may be stale", async ({ page }) => {
  await page.goto("/ru/app/offline");
  await expect(page.getByTestId("offline-screen")).toBeVisible();
  await expect(page.getByText(/устаревшей|stale/i)).toBeVisible();
});
```

- [ ] **Step 3: Run it**

```bash
cd ~/poolwatt && npx playwright test --project=mobile
```

Expected: 4 passed. A failure on tab counts means `visibleTabs` and the
layout disagree — fix the layout, not the test.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e/mobile-shell.mobile.spec.ts
git commit -m "test(mobile): the shell on a Pixel 7 against the live build"
```

---

## Task 10: Point the Android shell at /app

**Files:**
- Modify: `~/poolwatt-android/capacitor.config.json` (separate repo)

- [ ] **Step 1: Change the entry point**

```bash
cd ~/poolwatt-android
cat > capacitor.config.json <<'JSON'
{
  "appId": "com.poolwatt.android",
  "appName": "Poolwatt",
  "webDir": "www",
  "server": {
    "url": "https://poolwatt.com/app",
    "androidScheme": "https"
  },
  "android": {
    "backgroundColor": "#0c1014"
  }
}
JSON
```

`/app` with no locale lets the next-intl middleware pick the phone's
language — exactly what §25's locale list asks for.

- [ ] **Step 2: Build and publish**

```bash
/home/dv/bin/android-build
```

Expected: the script prints the latest and versioned download URLs.

- [ ] **Step 3: Check the page the app will open**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://poolwatt.com/app
```

Expected: `307 https://poolwatt.com/en/app` (or the locale the request
negotiates). A `404` means the middleware matcher excludes `/app` — widen it.

- [ ] **Step 4: Commit in the Android repo**

```bash
cd ~/poolwatt-android && git add -A && \
  git commit -m "feat: open the phone section instead of the desktop site"
```

---

## Task 11: Replace the iOS app with a Capacitor shell

**Files:** `/Users/aleksandrswiss/poolwatt-ios/` on the Mac, through the
reverse tunnel.

The SwiftUI producer list goes; the bundle id `com.poolwatt.ios`, the
provisioning profile and the two fastlane lanes stay, so TestFlight keeps
working.

- [ ] **Step 1: Keep what cannot be regenerated**

```bash
ssh -p 2222 aleksandrswiss@127.0.0.1 'cd ~/poolwatt-ios && \
  git checkout -b capacitor-shell && \
  mkdir -p keep && cp -R fastlane Gemfile Gemfile.lock *.mobileprovision keep/ && \
  ls keep'
```

Expected: `fastlane`, `Gemfile`, `Gemfile.lock`, the `.mobileprovision`.

- [ ] **Step 2: Create the Capacitor project next to it**

```bash
ssh -p 2222 aleksandrswiss@127.0.0.1 'cd ~ && rm -rf poolwatt-ios-cap && \
  mkdir poolwatt-ios-cap && cd poolwatt-ios-cap && \
  npm init -y >/dev/null && \
  npm i @capacitor/core @capacitor/ios && npm i -D @capacitor/cli && \
  mkdir -p www && printf "<!doctype html><title>Poolwatt</title>" > www/index.html && \
  npx cap init Poolwatt com.poolwatt.ios --web-dir www && \
  npx cap add ios && ls ios/App'
```

Expected: `App.xcodeproj`, `App`, `Podfile`.

- [ ] **Step 3: Give it the same server entry as Android**

```bash
ssh -p 2222 aleksandrswiss@127.0.0.1 'cd ~/poolwatt-ios-cap && cat > capacitor.config.json <<JSON
{
  "appId": "com.poolwatt.ios",
  "appName": "Poolwatt",
  "webDir": "www",
  "server": { "url": "https://poolwatt.com/app", "iosScheme": "https" },
  "ios": { "backgroundColor": "#0c1014", "contentInset": "always" }
}
JSON
npx cap sync ios'
```

- [ ] **Step 4: Move the kept pieces in and point the lanes at the new project**

```bash
ssh -p 2222 aleksandrswiss@127.0.0.1 'cd ~/poolwatt-ios-cap && \
  cp -R ~/poolwatt-ios/keep/fastlane ~/poolwatt-ios/keep/Gemfile ~/poolwatt-ios/keep/Gemfile.lock . && \
  cp ~/poolwatt-ios/keep/*.mobileprovision . && \
  grep -n "xcodeproj\|scheme\|workspace" fastlane/Fastfile'
```

Change every `PoolwattIOS.xcodeproj` to `ios/App/App.xcworkspace` and the
scheme to `App`. The `build_sim` lane keeps `run_tests` only if a test target
exists; a Capacitor shell has none, so drop that step from `build_sim` and
leave the simulator build.

- [ ] **Step 5: Prove the simulator build**

```bash
ssh -p 2222 aleksandrswiss@127.0.0.1 'cd ~/poolwatt-ios-cap && bundle exec fastlane build_sim'
```

Expected: `fastlane.tools finished successfully`.

- [ ] **Step 6: Swap the directories and commit on the Mac**

```bash
ssh -p 2222 aleksandrswiss@127.0.0.1 'mv ~/poolwatt-ios ~/poolwatt-ios-swiftui-archive && \
  mv ~/poolwatt-ios-cap ~/poolwatt-ios && cd ~/poolwatt-ios && git init -q && \
  git add -A && git commit -q -m "feat: Capacitor shell over poolwatt.com/app" && \
  git log --oneline -1'
```

The SwiftUI tree stays on disk as `poolwatt-ios-swiftui-archive` until a
TestFlight build from the new shell is accepted.

- [ ] **Step 7: Send a build to TestFlight**

```bash
/home/dv/bin/mac-ios --lane release_testflight
```

Expected: exit 0 and an upload confirmation. Apple then needs 5–15 minutes.

- [ ] **Step 8: Update the repo documentation**

In `CLAUDE.md`, the iOS section now describes a Capacitor shell, not a
SwiftUI app. Replace the sentence "the iOS project lives in
`/Users/aleksandrswiss/poolwatt-ios/` on the Mac (separate repo)" with the
same sentence plus "— a Capacitor shell over `poolwatt.com/app` since
2026-11-25; the old SwiftUI app is archived next to it."

```bash
cd ~/poolwatt && git add CLAUDE.md && \
  git commit -m "docs: the iOS app is a Capacitor shell now"
```

---

## Task 12: Whole suite before the deploy

- [ ] **Step 1: Unit and integration**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run
```

Expected: the same pass count as before this plan plus the 8 new cases from
Task 1. The two `bot/__tests__/tts-bilingual.test.ts` cases need a working
`OPENAI_API_KEY`.

- [ ] **Step 2: End to end, both projects**

```bash
npx playwright test
```

Expected: all passed.

- [ ] **Step 3: Push**

```bash
cd ~/poolwatt && git status --short && git push
```

- [ ] **Step 4: Tick M1 in the tracker**

Set the M1 row in `inbox/TZ-STATUS.md` to `готово` with the commit range, the
APK URL and the TestFlight build number as evidence. The file is gitignored;
do not commit it.

---

## Self-review notes

- Spec coverage: M1 of the spec lists the route section (Tasks 5, 7, 8), the
  bottom bar (Task 5), the mobile theme (Tasks 5, 7 — the shell reuses the
  existing dark palette rather than inventing a second one), the §20 status
  context (Tasks 1, 2, 5), the manifest and worker (Task 6), the iOS
  replacement (Task 11) and Android (Task 10). Covered.
- The spec's `DeviceKey` and `PushToken` tables belong to M4 and M6 and are
  deliberately absent here.
- `visibleTabs`, `moreSections`, `TAB_HREF` and `SECTION_HREF` are used in
  Tasks 5, 7 and 8 under exactly the names Task 1 defines.
