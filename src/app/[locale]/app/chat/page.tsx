// §48 на телефоне: комнаты внутреннего чата и сам разговор.
//
// Один экран на список и на комнату: комната живёт в адресе (`?room=`),
// поэтому «назад» из комнаты возвращает в список, а не из приложения.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { Screen } from "@/components/mobile/screen";
import { ChatThread } from "@/components/work/chat-thread";
import { readRoomForUser } from "@/lib/work/chat-access";
import { listMyRooms, readRoomMessages } from "@/lib/work/chat-service";

export const dynamic = "force-dynamic";

export default async function MobileChat({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ room?: string }>;
}) {
  const { locale } = await params;
  const { room } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/app/chat`);
  }

  const t = await getTranslations("chat");

  if (room) {
    const active = await readRoomForUser(room, session.user.id, session.user.role);
    if (!active) notFound();
    const messages = await readRoomMessages(room, session.user.id, session.user.role);
    return (
      <Screen title={active.title} back={`/${locale}/app/chat`}>
        <ChatThread
          roomKey={room}
          messages={messages}
          canWrite={active.canWrite}
          compact
          labels={{
            title: t(`kind.${active.ref.kind}`),
            placeholder: t("placeholder"),
            send: t("send"),
            sending: t("sending"),
            system: t("system"),
            live: t("live"),
            empty: t("empty"),
            queued: t("queued"),
            offline: t("offline"),
          }}
        />
      </Screen>
    );
  }

  const rooms = await listMyRooms(session.user.id, session.user.role);

  return (
    <Screen title={t("title")} back={`/${locale}/app/more`}>
      {rooms.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted" data-testid="chat-no-rooms">
          {t("noRooms")}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-hairline" data-testid="chat-rooms">
          {rooms.map((r) => (
            <li key={r.key} className="py-3">
              <Link
                href={`/${locale}/app/chat?room=${r.key}`}
                prefetch={false}
                data-room={r.key}
                className="flex items-center justify-between gap-3"
              >
                <span>
                  <span className="block text-[15px]">{r.title}</span>
                  <span className="block text-[12px] text-muted">
                    {t(`kind.${r.kind}`)}
                    {r.note && <> · {r.note}</>}
                  </span>
                </span>
                {r.unread > 0 && (
                  <span
                    className="num rounded-full bg-accent px-2 py-0.5 text-[11px] text-background"
                    data-testid="chat-unread"
                  >
                    {r.unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
