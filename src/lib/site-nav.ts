// Разделы сайта одним списком. До этого модуля ссылки жили разметкой внутри
// `navbar.tsx` и `footer.tsx` — в двух местах, с двумя наборами адресов, и
// ничто не проверяло, что адрес ведёт на существующую страницу. Так в меню
// годами стояли `/hubs`, `/offers`, `/watchlist` и `/settings`: все четыре
// отдавали 404 на живой сборке.
//
// Теперь разделы — данные. Шапка, гамбургер и подвал читают этот файл, а
// `site-nav.test.ts` сверяет каждый адрес с файлом страницы на диске.
//
// `href` идёт без языка: его подставляет тот, кто рисует ссылку, потому что
// язык знает страница, а не список разделов.

export type NavAudience = "anyone" | "signedIn" | "operator";

export interface NavItem {
  /** Ключ строки интерфейса: `nav.items.<key>`. */
  key: string;
  href: string;
  audience: NavAudience;
}

export interface NavGroup {
  /** Ключ заголовка группы: `nav.groups.<key>`. */
  key: string;
  items: NavItem[];
}

export interface NavContext {
  signedIn: boolean;
  operator: boolean;
}

/**
 * Порядок — «что человеку нужно раньше», а не алфавит. Первой стоит зарядка:
 * с этим на сайт приходит водитель, и это же обещает §20 незашедшему.
 */
export const SITE_NAV: NavGroup[] = [
  {
    key: "energy",
    items: [
      { key: "chargers", href: "/navigator", audience: "anyone" },
      { key: "producers", href: "/", audience: "anyone" },
      { key: "exchange", href: "/exchange", audience: "anyone" },
    ],
  },
  {
    key: "mine",
    items: [
      { key: "cabinet", href: "/me", audience: "signedIn" },
      { key: "wallet", href: "/me/wallet", audience: "signedIn" },
      { key: "bookings", href: "/me/bookings", audience: "signedIn" },
      { key: "favorites", href: "/me/favorites", audience: "signedIn" },
      { key: "support", href: "/me/tickets", audience: "signedIn" },
      { key: "settings", href: "/me/settings", audience: "signedIn" },
    ],
  },
  {
    key: "partners",
    items: [
      {
        key: "buildRequest",
        href: "/me/build-requests/new",
        audience: "anyone",
      },
      { key: "contractors", href: "/contractors", audience: "anyone" },
      { key: "listing", href: "/me/listing", audience: "signedIn" },
      {
        key: "chargerOperator",
        href: "/me/charger-operator",
        audience: "signedIn",
      },
    ],
  },
  {
    key: "apps",
    items: [{ key: "install", href: "/install", audience: "anyone" }],
  },
  {
    key: "operator",
    // У раздела `/admin` нет своей страницы-оглавления: оператор приходит
    // туда за решением по листингу (US-02), поэтому ссылка ведёт на очередь
    // заявок, а не на адрес, которого нет.
    items: [{ key: "listings", href: "/admin/listings", audience: "operator" }],
  },
];

/** Короткий ряд в шапке на мониторе — первая группа и только она. */
export const PRIMARY_GROUP = "energy";

function allows(audience: NavAudience, ctx: NavContext): boolean {
  if (audience === "anyone") return true;
  if (audience === "signedIn") return ctx.signedIn;
  return ctx.operator;
}

/** Группы и разделы, которые этот человек имеет право видеть. */
export function visibleNav(ctx: NavContext): NavGroup[] {
  return SITE_NAV.map((group) => ({
    key: group.key,
    items: group.items.filter((item) => allows(item.audience, ctx)),
  })).filter((group) => group.items.length > 0);
}

/** Разделы первой группы — ряд в шапке. */
export function primaryItems(ctx: NavContext): NavItem[] {
  const group = visibleNav(ctx).find((g) => g.key === PRIMARY_GROUP);
  return group?.items ?? [];
}

/** Адрес раздела с языком. */
export function navHref(locale: string, href: string): string {
  return href === "/" ? `/${locale}` : `/${locale}${href}`;
}
