// §51.5 на телефоне: заявка, фотографии и переписка одной колонкой.

import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Screen } from "@/components/mobile/screen";
import { TicketThread } from "@/components/work/ticket-thread";
import { readTicketForUser } from "@/lib/work/ticket-access";
import { readThread } from "@/lib/work/ticket-view";
import { threadLabels } from "@/lib/work/ticket-labels";

export const dynamic = "force-dynamic";

export default async function MobileTicket({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/app/tickets/${id}`);
  }

  const seen = await readTicketForUser(id, session.user.id, session.user.role);
  if (!seen) notFound();
  const ticket = seen.ticket;

  const t = await getTranslations("tickets");
  const tReport = await getTranslations("report");
  const point = ticket.pointId
    ? await prisma.acceptancePoint.findUnique({
        where: { id: ticket.pointId },
        select: { id: true, name: true, city: true },
      })
    : null;
  const thread = await readThread(ticket.id);

  return (
    <Screen title={tReport(`type.${ticket.problemType}`)} back={`/${locale}/app/tickets`}>
      <p className="mt-1 text-[13px] text-muted">
        {point && (
          <>
            <Link href={`/${locale}/app/c/${point.id}`} prefetch={false} className="underline">
              {point.name}
            </Link>
            {" · "}
          </>
        )}
        <span data-testid="ticket-status">{t(`status.${ticket.status}`)}</span>
      </p>

      {ticket.photos.length > 0 && (
        <ul className="mt-4 flex gap-2 overflow-x-auto" data-testid="ticket-photos">
          {ticket.photos.map((key) => (
            <li key={key} className="shrink-0">
              <Image
                src={`/api/v1/ticket-photos/${key}`}
                alt={tReport(`type.${ticket.problemType}`)}
                width={160}
                height={120}
                unoptimized
                className="h-[120px] w-auto rounded border border-hairline object-cover"
              />
            </li>
          ))}
        </ul>
      )}

      <TicketThread
        ticketId={ticket.id}
        messages={thread}
        canWrite={seen.canWrite}
        canResolve={false}
        closed={ticket.status === "CLOSED"}
        labels={threadLabels(t)}
      />
    </Screen>
  );
}
