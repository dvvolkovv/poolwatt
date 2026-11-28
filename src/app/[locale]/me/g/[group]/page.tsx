// Вложенная доска плиток. Открывается плиткой-узлом с дома кабинета: доска
// аккаунта (её открывает плитка пользователя) и доска оператора платформы.
//
// Отдельный адрес, а не раскрытие на месте: тогда доска переживает
// перезагрузку, её можно дать ссылкой, а единственная кнопка «назад» в шапке
// знает, куда вести, не спрашивая историю браузера.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { transfersOpen } from "@/lib/exchange/gates";
import { readCabinetContext } from "@/lib/cabinet/context";
import { GROUP_KEYS, canOpenGroup, type GroupKey } from "@/lib/cabinet/tiles";
import { accentStyle } from "@/lib/cabinet/accents";
import { CabinetBoard } from "@/components/cabinet/board";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; group: string }> };

export default async function GroupBoardPage({ params }: Props) {
  const { locale, group } = await params;
  setRequestLocale(locale);

  if (!GROUP_KEYS.includes(group as GroupKey)) notFound();
  const board = group as GroupKey;

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/g/${board}`);
  }

  const ctx = await readCabinetContext(
    session.user.id,
    session.user.role === "ADMIN",
  );

  // Доска существует для человека, только если ему открыта её дверь. Проверять
  // «есть ли на доске хоть одна плитка» было бы мало: доска оператора набрана
  // из обычных плиток без своих требований, и такая проверка пускала бы на неё
  // кого угодно.
  if (!canOpenGroup(board, ctx.caps)) notFound();

  const t = await getTranslations("cabinetTiles");

  return (
    <div style={accentStyle(ctx.accent)}>
      <h1 className="mb-5 text-[26px] md:text-[32px] font-bold tracking-[-0.02em]">
        {t(`boards.${board}`)}
      </h1>
      <CabinetBoard
        board={board}
        locale={locale}
        ctx={ctx}
        gates={{
          transfers: transfersOpen(),
          fiatTopUp: Boolean(process.env.PAYMENT_PROVIDER),
        }}
      />
    </div>
  );
}
