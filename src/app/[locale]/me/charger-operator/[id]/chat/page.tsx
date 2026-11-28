// Комнаты внутреннего чата сети — ТЗ §48 «Внутренний чат команды».
//
// Комната живёт в адресе (`?room=`), как фильтры навигатора: ссылку на
// разговор можно послать, и возврат по «назад» показывает то же.

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ChatThread } from "@/components/work/chat-thread";
import { readRoomForUser } from "@/lib/work/chat-access";
import { listMyRooms, readRoomMessages } from "@/lib/work/chat-service";

export const dynamic = "force-dynamic";

export default async function OperatorChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ room?: string }>;
}) {
  const { locale, id } = await params;
  const { room } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/chat`);
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true },
  });
  if (!operator) notFound();

  // Комната сети — это право быть в ней; не в ней — страницы нет.
  const network = await readRoomForUser(`net-${id}`, session.user.id, session.user.role);
  if (!network) notFound();

  const t = await getTranslations("chat");

  const all = await listMyRooms(session.user.id, session.user.role);
  // Комнаты этой сети: её собственная и её бригады. Наряды живут на своих
  // страницах — там, где видно, о чём разговор.
  const crewIds = (
    await prisma.crew.findMany({ where: { operatorId: id }, select: { id: true } })
  ).map((c) => `crew-${c.id}`);
  const rooms = all.filter((r) => r.key === `net-${id}` || crewIds.includes(r.key));

  const activeKey = room && rooms.some((r) => r.key === room) ? room : `net-${id}`;
  const active = await readRoomForUser(activeKey, session.user.id, session.user.role);
  if (!active) notFound();
  const messages = await readRoomMessages(activeKey, session.user.id, session.user.role);

  return (
    <div>
      <Link
        href={`/${locale}/me/charger-operator/${id}`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {operator.displayName}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-6 text-[28px] font-bold">{t("title")}</h1>

      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <nav data-testid="chat-rooms">
          <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-muted">
            {t("rooms")}
          </div>
          <ul className="divide-y divide-hairline rounded border border-hairline">
            {rooms.map((r) => (
              <li key={r.key}>
                <Link
                  href={`/${locale}/me/charger-operator/${id}/chat?room=${r.key}`}
                  prefetch={false}
                  data-room={r.key}
                  aria-current={r.key === activeKey ? "page" : undefined}
                  className={`flex items-center justify-between px-3 py-2 text-[13px] ${
                    r.key === activeKey ? "bg-accent/10" : ""
                  }`}
                >
                  <span>
                    {r.title}
                    <span className="block text-[11px] text-muted">{t(`kind.${r.kind}`)}</span>
                  </span>
                  {r.unread > 0 && (
                    <span className="num text-[11px] text-accent" data-testid="chat-unread">
                      {r.unread}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <section>
          <h2 className="text-[15px] font-semibold">{active.title}</h2>
          <ChatThread
            roomKey={activeKey}
            messages={messages}
            canWrite={active.canWrite}
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
        </section>
      </div>
    </div>
  );
}
