// Доска кабинета: берёт плитки доски, отбрасывает те, на которые у человека
// нет права, раскладывает в порядке, который он сам выбрал, и рисует.
//
// Один рендер на все доски: дом кабинета, настройки и оператор отличаются
// только списком плиток, а не правилами.

import { getTranslations } from "next-intl/server";
import type { CabinetContext } from "@/lib/cabinet/context";
import {
  boardPath,
  orderTiles,
  tilesFor,
  type BoardKey,
  type TileGate,
} from "@/lib/cabinet/tiles";
import { TileBoard } from "./tile-board";
import { ClosedTile, Tile } from "./tile";
import { SignOutTile } from "./sign-out-tile";

/** Знак на плитке. Не переводится: это рисунок, а не слово. */
export const TILE_GLYPH: Record<string, string> = {
  wallet: "⚡",
  bookings: "📅",
  support: "💬",
  favorites: "★",
  gifts: "🎁",
  roaming: "✈",
  build: "🔧",
  company: "📄",
  producer: "🏠",
  network: "🔌",
  contractor: "🏢",
  coop: "🤝",
  workOrders: "🛠",
  operator: "🛡",
  buy: "＋",
  charge: "🔌",
  transfer: "⇄",
  topUp: "💳",
  settings: "⚙",
  interface: "🎨",
  signOut: "⎋",
  adminListings: "📄",
  adminBuildRequests: "🔧",
  adminContractors: "🏢",
  adminPoints: "🔌",
  adminZones: "🌍",
  adminRoaming: "✈",
  adminMarketing: "📣",
  adminFeePlans: "💳",
  adminReconciliation: "🧮",
  adminReceiptClaims: "🧾",
};

export async function CabinetBoard({
  board,
  locale,
  ctx,
  gates,
}: {
  board: BoardKey;
  locale: string;
  ctx: CabinetContext;
  /** Открытые переключатели. Закрытый делает плитку немой с подписью. */
  gates: Record<TileGate, boolean>;
}) {
  const t = await getTranslations("cabinetTiles");
  const defs = tilesFor(board, ctx.caps);
  // Свой порядок человек задаёт только дому: вложенные доски — это списки
  // разделов, и переставлять их незачем.
  const tiles = board === "root" ? orderTiles(defs, ctx.order) : defs;

  return (
    <TileBoard accent={ctx.accent}>
      {tiles.map((tile) => {
        const label = t(`labels.${tile.key}`);
        const glyph = TILE_GLYPH[tile.key] ?? "◻";

        if (tile.gate && !gates[tile.gate]) {
          return (
            <ClosedTile
              key={tile.key}
              label={label}
              glyph={glyph}
              hint={t(`closed.${tile.key}`)}
              testId={`tile-${tile.key}`}
            />
          );
        }

        if (tile.target.kind === "signOut") {
          return (
            <SignOutTile
              key={tile.key}
              locale={locale}
              label={label}
              glyph={glyph}
            />
          );
        }

        const href =
          tile.target.kind === "group"
            ? `/${locale}${boardPath(tile.target.group)}`
            : `/${locale}${tile.target.href}`;

        const value = tile.value ? ctx.values[tile.value] : undefined;
        const unit = tile.value ? t(`units.${tile.value}`) : undefined;

        return (
          <Tile
            key={tile.key}
            href={href}
            label={label}
            glyph={glyph}
            value={value}
            unit={value ? unit : undefined}
            testId={`tile-${tile.key}`}
          />
        );
      })}
    </TileBoard>
  );
}
