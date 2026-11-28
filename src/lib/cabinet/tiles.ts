// Кабинет как доски плиток. До этого модуля навигация кабинета была полосой
// из десяти текстовых ссылок (`me/layout.tsx`, `overflow-x-auto`), одинаковой
// для всех: «Моя компания», «Подрядчик» и «Наряды» стояли и у аккаунта,
// который только что зарегистрировался, и вели на пустые страницы.
//
// Правила, которые этот файл держит:
//   * плитка без своей способности отсутствует, а не рисуется серой —
//     обещание, за которым пусто, хуже отсутствия плитки;
//   * плитка-лист ведёт на страницу, которая есть на диске (это сверяет
//     `tiles.test.ts`, тем же приёмом, что `site-nav.test.ts`);
//   * у каждой страницы кабинета есть своя доска, поэтому единственная
//     кнопка «назад» в шапке вычисляется из адреса, а не из истории
//     браузера, и ведёт верно даже при переходе по прямой ссылке.

export const GROUP_KEYS = ["account", "operator"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

/** Доска: дом кабинета или одна из групп. */
export type BoardKey = "root" | GroupKey;

export type CapabilityKey =
  | "hasCompany"
  | "hasProducer"
  | "isContractor"
  | "hasNetwork"
  | "isCoopMember"
  | "isStaff"
  | "isOperator";

export type Capabilities = Record<CapabilityKey, boolean>;

/** Какую цифру плитка печатает под названием. */
export type TileValueKey =
  | "walletBalance"
  | "bookingsAhead"
  | "favoritesCount"
  | "openTickets"
  | "activeGifts"
  | "buildRequests"
  | "coopShares"
  | "myWorkOrders";

export type TileTarget =
  | { kind: "page"; href: string }
  | { kind: "group"; group: GroupKey }
  | { kind: "signOut" };

/**
 * Переключатель, от которого зависит плитка. Закрытый не убирает плитку, а
 * делает её немой и подписывает, чего она ждёт: §22.2 называет «Перевести» и
 * «Пополнить» быстрыми кнопками, и честнее сказать «ждёт банка», чем сделать
 * вид, что раздела нет.
 */
export type TileGate = "transfers" | "fiatTopUp";

export interface TileDef {
  key: string;
  target: TileTarget;
  needs?: CapabilityKey;
  value?: TileValueKey;
  gate?: TileGate;
}

const page = (href: string): TileTarget => ({ kind: "page", href });
const group = (g: GroupKey): TileTarget => ({ kind: "group", group: g });

export const CABINET_BOARDS: Record<BoardKey, TileDef[]> = {
  root: [
    { key: "wallet", target: page("/me/wallet"), value: "walletBalance" },
    // §22.2 «быстрые кнопки»: четыре действия, которые были ссылками под
    // балансом. Две из них ждут внешнюю сторону и говорят об этом словами.
    { key: "buy", target: page("/me/wallet") },
    { key: "charge", target: page("/navigator") },
    { key: "transfer", target: page("/me/wallet"), gate: "transfers" },
    { key: "topUp", target: page("/me/wallet"), gate: "fiatTopUp" },
    { key: "bookings", target: page("/me/bookings"), value: "bookingsAhead" },
    { key: "support", target: page("/me/tickets"), value: "openTickets" },
    {
      key: "favorites",
      target: page("/me/favorites"),
      value: "favoritesCount",
    },
    { key: "gifts", target: page("/me/gifts"), value: "activeGifts" },
    { key: "roaming", target: page("/me/roaming") },
    {
      key: "build",
      target: page("/me/build-requests"),
      value: "buildRequests",
    },
    { key: "company", target: page("/me/listing"), needs: "hasCompany" },
    { key: "producer", target: page("/me/producer"), needs: "hasProducer" },
    {
      key: "network",
      target: page("/me/charger-operator"),
      needs: "hasNetwork",
    },
    {
      key: "contractor",
      target: page("/me/contractor"),
      needs: "isContractor",
    },
    {
      key: "coop",
      target: page("/me/coop"),
      needs: "isCoopMember",
      value: "coopShares",
    },
    {
      key: "workOrders",
      target: page("/me/work-orders"),
      needs: "isStaff",
      value: "myWorkOrders",
    },
    { key: "operator", target: group("operator"), needs: "isOperator" },
  ],

  // Доска, которую открывает плитка пользователя: владелец просил, чтобы
  // нажатие на юзера вело в его настройки.
  account: [
    { key: "settings", target: page("/me/settings") },
    { key: "interface", target: page("/me/settings/interface") },
    { key: "signOut", target: { kind: "signOut" } },
  ],

  operator: [
    { key: "adminListings", target: page("/admin/listings") },
    { key: "adminBuildRequests", target: page("/admin/build-requests") },
    { key: "adminContractors", target: page("/admin/contractors") },
    { key: "adminPoints", target: page("/admin/points") },
    { key: "adminZones", target: page("/admin/zones") },
    { key: "adminRoaming", target: page("/admin/roaming") },
    { key: "adminMarketing", target: page("/admin/marketing") },
    { key: "adminFeePlans", target: page("/admin/fee-plans") },
    { key: "adminReconciliation", target: page("/admin/reconciliation") },
    { key: "adminReceiptClaims", target: page("/admin/receipt-claims") },
  ],
};

/** Плитки доски, которые этот человек имеет право видеть. */
export function tilesFor(board: BoardKey, caps: Capabilities): TileDef[] {
  return CABINET_BOARDS[board].filter(
    (tile) => !tile.needs || caps[tile.needs],
  );
}

/**
 * Сохранённый человеком порядок, применённый мягко: незнакомый ключ
 * отбрасывается, а плитка, которой при настройке ещё не было, дописывается в
 * конец. Иначе человек, получивший компанию после настройки порядка, увидел
 * бы на её месте пустоту.
 */
export function orderTiles(
  defs: TileDef[],
  saved: readonly string[] | null | undefined,
): TileDef[] {
  if (!saved || saved.length === 0) return defs;
  const byKey = new Map(defs.map((tile) => [tile.key, tile]));
  const ordered: TileDef[] = [];
  for (const key of saved) {
    const tile = byKey.get(key);
    if (!tile) continue;
    byKey.delete(key);
    ordered.push(tile);
  }
  return [...ordered, ...defs.filter((tile) => byKey.has(tile.key))];
}

/** На какой доске живёт плитка с этим ключом. */
export function boardOf(key: string): BoardKey | null {
  for (const board of Object.keys(CABINET_BOARDS) as BoardKey[]) {
    if (CABINET_BOARDS[board].some((tile) => tile.key === key)) return board;
  }
  return null;
}

/** Адрес доски. */
export function boardPath(board: BoardKey): string {
  return board === "root" ? "/me" : `/me/g/${board}`;
}

/**
 * Куда ведёт единственная кнопка шапки. Считается из адреса, поэтому верна и
 * при переходе по прямой ссылке, где истории браузера нет.
 */
export function parentPath(pathWithoutLocale: string): string | null {
  const path = pathWithoutLocale.replace(/\/+$/, "") || "/";
  if (path === "/me") return null;

  const groupMatch = /^\/me\/g\/([a-z]+)$/.exec(path);
  if (groupMatch) return "/me";

  // Страница раздела: её доска — та, на которой стоит её плитка. Берётся
  // самая длинная совпавшая плитка, чтобы вложенный адрес
  // (`/me/listing/<id>`) нашёл свою, а не чужую.
  let best: { href: string; board: BoardKey } | null = null;
  for (const board of Object.keys(CABINET_BOARDS) as BoardKey[]) {
    for (const tile of CABINET_BOARDS[board]) {
      if (tile.target.kind !== "page") continue;
      const href = tile.target.href;
      if (path === href || path.startsWith(`${href}/`)) {
        if (!best || href.length > best.href.length) best = { href, board };
      }
    }
  }
  if (!best) return "/me";
  return boardPath(best.board);
}

/**
 * Порядок, пришедший из браузера, перед записью в базу. Оставляет только
 * ключи плиток, которые у этого человека действительно есть, и убирает
 * повторы: иначе в `User.tileOrder` можно было бы положить что угодно, и
 * доска читала бы мусор при каждой загрузке.
 */
export function sanitizeTileOrder(
  raw: unknown,
  allowed: readonly string[],
): string[] {
  if (!Array.isArray(raw)) return [];
  const permitted = new Set(allowed);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of raw) {
    if (typeof key !== "string") continue;
    if (!permitted.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Способность, без которой доска группы не существует для человека.
 *
 * Объявлена явно, а не выведена из плитки-двери: дверь доски `account` — это
 * плитка пользователя, которая рисуется отдельно и в каталоге плиток её нет.
 * Выводить право из каталога значило бы молча отдать доску оператора каждому:
 * она набрана из десяти обычных плиток без собственных требований, и проверка
 * «есть ли на доске хоть одна плитка» её не защищает. Страницы админки
 * защищены своим layout'ом, но показывать их список постороннему всё равно
 * нельзя. Одна дверь, одно право, записанное здесь.
 */
export const GROUP_NEEDS: Record<GroupKey, CapabilityKey | null> = {
  // Свой аккаунт есть у каждого, кто вошёл.
  account: null,
  operator: "isOperator",
};

/** Может ли человек открыть доску группы. */
export function canOpenGroup(group: GroupKey, caps: Capabilities): boolean {
  const needs = GROUP_NEEDS[group];
  return needs === null || caps[needs];
}
