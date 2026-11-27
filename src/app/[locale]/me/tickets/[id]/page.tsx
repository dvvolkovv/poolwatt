// §51.5 — состояние заявки, фотографии с места и переписка с поддержкой.

import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TicketThread } from "@/components/work/ticket-thread";
import { readTicketForUser } from "@/lib/work/ticket-access";
import { readThread } from "@/lib/work/ticket-view";
import { threadLabels } from "@/lib/work/ticket-labels";

export const dynamic = "force-dynamic";

export default async function MyTicketPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/tickets/${id}`);
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
    <div>
      <Link
        href={`/${locale}/me/tickets`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {t("mine")}
      </Link>

      <h1 className="mt-4 text-[24px] font-bold">{tReport(`type.${ticket.problemType}`)}</h1>
      <p className="mt-1 text-[13px] text-muted">
        {point && (
          <>
            <Link href={`/${locale}/c/${point.id}`} prefetch={false} className="underline">
              {point.name}
            </Link>
            {point.city ? `, ${point.city}` : ""} ·{" "}
          </>
        )}
        <span data-testid="ticket-status">{t(`status.${ticket.status}`)}</span>
        {ticket.respondBy && ticket.firstRespondedAt === null && ticket.status !== "CLOSED" && (
          <>
            {" · "}
            {t("respondBy")}{" "}
            <span className="num">{ticket.respondBy.toISOString().slice(11, 16)}</span>
          </>
        )}
      </p>

      {ticket.compensation && (
        <p className="mt-2 text-[13px]" data-testid="ticket-compensation-given">
          {t("compensation.mineHeading")}:{" "}
          <span className="num">{ticket.compensation}</span>
        </p>
      )}

      {ticket.photos.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" data-testid="ticket-photos">
          {ticket.photos.map((key) => (
            <li key={key}>
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
    </div>
  );
}
