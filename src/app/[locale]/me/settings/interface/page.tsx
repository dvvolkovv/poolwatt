// Настройки интерфейса кабинета: цвет контура плиток и их порядок. Открывается
// плиткой «Интерфейс» с доски аккаунта, то есть через плитку пользователя.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { readCabinetContext } from "@/lib/cabinet/context";
import { orderTiles, tilesFor } from "@/lib/cabinet/tiles";
import { TILE_ACCENTS, type TileAccent } from "@/lib/cabinet/accents";
import { TILE_GLYPH } from "@/components/cabinet/board";
import { InterfaceEditor } from "@/components/cabinet/interface-editor";
import { resetTileOrder, saveInterfacePrefs } from "./actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function InterfaceSettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/settings/interface`);
  }

  const ctx = await readCabinetContext(
    session.user.id,
    session.user.role === "ADMIN",
  );
  const t = await getTranslations("interfaceSettings");
  const tTiles = await getTranslations("cabinetTiles");

  // Переставлять можно только то, что у человека есть, и в том порядке, в
  // котором он это видит сейчас.
  const tiles = orderTiles(tilesFor("root", ctx.caps), ctx.order).map(
    (tile) => ({
      key: tile.key,
      label: tTiles(`labels.${tile.key}`),
      glyph: TILE_GLYPH[tile.key] ?? "◻",
    }),
  );

  const accentNames = Object.fromEntries(
    TILE_ACCENTS.map((a) => [a, t(`accents.${a}`)]),
  ) as Record<TileAccent, string>;

  return (
    <div>
      <h1 className="text-[26px] md:text-[32px] font-bold tracking-[-0.02em]">
        {t("title")}
      </h1>
      <p className="mt-2 mb-8 max-w-[560px] text-[14px] text-muted">
        {t("subtitle")}
      </p>

      <InterfaceEditor
        tiles={tiles}
        accent={ctx.accent}
        accentNames={accentNames}
        action={saveInterfacePrefs}
        resetAction={resetTileOrder}
        labels={{
          accentTitle: t("accentTitle"),
          accentHint: t("accentHint"),
          orderTitle: t("orderTitle"),
          orderHint: t("orderHint"),
          up: t("up"),
          down: t("down"),
          save: t("save"),
          reset: t("reset"),
        }}
      />
    </div>
  );
}
