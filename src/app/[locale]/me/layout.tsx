// Оболочка кабинета. До 2026-11-28 она рисовала боковое меню, которое на
// телефоне превращалось в полосу из десяти текстовых ссылок с горизонтальной
// прокруткой, одинаковую для всех: «Моя компания», «Подрядчик» и «Наряды»
// стояли и у аккаунта, у которого ничего из этого нет.
//
// Теперь навигация — доска плиток на самом `/me`, а в шапке остаётся ровно
// одна кнопка: вернуться на доску, которой принадлежит открытая страница.

import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { accentStyle, parseTileAccent } from "@/lib/cabinet/accents";
import { BackTile } from "@/components/cabinet/back-tile";

export default async function CabinetLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me`);
  }

  const tTiles = await getTranslations("cabinetTiles");
  const tEmail = await getTranslations("cabinet.addEmailBanner");

  // Only for accounts with a password: without one there is nothing to recover.
  const [account, prefs] = await Promise.all([
    prisma.user.findFirst({
      where: { id: session.user.id, email: null, passwordHash: { not: null } },
      select: {
        emailVerificationTokens: {
          where: { expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { email: true },
        },
      },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { tileAccent: true },
    }),
  ]);
  const pendingEmail = account?.emailVerificationTokens[0]?.email;

  return (
    <main
      className="bg-bg min-h-[calc(100vh-4rem)]"
      style={accentStyle(parseTileAccent(prefs?.tileAccent))}
    >
      <div className="mx-auto max-w-[1100px] px-4 md:px-8 py-6 md:py-10">
        <div className="mb-5">
          <BackTile locale={locale} label={tTiles("boards.back")} />
        </div>

        {account && (
          <div className="mb-8 rounded-xl border border-[color:var(--tile-line)] bg-card px-4 py-3">
            <div className="text-[14px] font-semibold">
              {tEmail(pendingEmail ? "pendingTitle" : "title")}
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {tEmail(pendingEmail ? "pendingBody" : "body")}{" "}
              {pendingEmail && (
                <b className="text-foreground">{pendingEmail}</b>
              )}
            </p>
            <Link
              href={`/${locale}/me/settings`}
              prefetch={false}
              className="mt-2 inline-flex min-h-[44px] items-center text-[13px] text-[color:var(--tile-line-strong)] hover:underline"
            >
              {tEmail(pendingEmail ? "pendingCta" : "cta")}
            </Link>
          </div>
        )}

        {children}
      </div>
    </main>
  );
}
