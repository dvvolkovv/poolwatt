// Никнейм в шапке — вход в аккаунт, и больше ничего.
//
// До 2026-11-28 это было выпадающее меню из трёх строк («Кабинет»,
// «Настройки», «Выйти»), то есть третий способ попасть туда же, куда ведут
// гамбургер и доска аккаунта. Владелец попросил оставить сбоку только
// учётную запись: имя и вход в неё. Поэтому здесь обычная ссылка на доску
// `account`, где и стоят настройки, интерфейс и выход.
//
// Ссылка, а не кнопка, ещё и потому, что это серверная отрисовка без
// состояния: на телефон не уезжает ни байта JavaScript.

import Link from "next/link";

export function AccountPill({
  username,
  locale,
  label,
}: {
  username: string;
  locale: string;
  label: string;
}) {
  return (
    <Link
      href={`/${locale}/me/g/account`}
      prefetch={false}
      data-testid="account-pill"
      aria-label={`@${username} — ${label}`}
      // `min-w-0` и `truncate`: длинный никнейм не имеет права расталкивать
      // ряд шапки — именно от этого страница ездила вправо-влево.
      className="inline-flex min-w-0 items-center gap-2 rounded-full border border-hairline px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-foreground transition-all hover:border-accent/60"
    >
      <span
        aria-hidden
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground"
      >
        {username.slice(0, 1).toUpperCase()}
      </span>
      <span className="truncate">@{username}</span>
    </Link>
  );
}
