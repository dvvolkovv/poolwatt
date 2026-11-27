// Рабочее место поддержки — §48 «Поддержка и коммуникации», §51.
//
// До этой работы у роли «Служба поддержки» §47 был только список на чтение:
// право `tickets.write` существовало и не проверялось ни одной строкой кода,
// потому что делать на странице было нечего.

import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TicketThread } from "@/components/work/ticket-thread";
import { TicketCompensationPanel } from "@/components/work/ticket-compensation-panel";
import { readCompensationCampaign } from "@/lib/work/ticket-compensation";
import { num } from "@/lib/exchange/decimal";
import { roundMoney } from "@/lib/exchange/precision";
import { readTicketForUser } from "@/lib/work/ticket-access";
import { readThread, toListRow } from "@/lib/work/ticket-view";
import { threadLabels } from "@/lib/work/ticket-labels";

export const dynamic = "force-dynamic";

export default async function SupportTicketPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; ticketId: string }>;
}) {
  const { locale, id, ticketId } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(
      `/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/tickets/${ticketId}`,
    );
  }

  const seen = await readTicketForUser(ticketId, session.user.id, session.user.role);
  // Заявка чужой сети по адресу этой — тоже «нет такой заявки».
  if (!seen || seen.ticket.operatorId !== id) notFound();
  const ticket = seen.ticket;

  const t = await getTranslations("tickets");
  const tReport = await getTranslations("report");

  const full = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: {
      point: { select: { id: true, name: true, city: true } },
      connector: { select: { type: true, powerKw: true } },
      reporter: { select: { username: true } },
      workOrder: { select: { id: true, title: true } },
      messages: { orderBy: { createdAt: "asc" } },
      // §51 — обжалуемый сеанс и то, что по нему уже вернули.
      payment: {
        select: {
          amountFiat: true,
          cardId: true,
          capturedAt: true,
          point: { select: { name: true } },
          zone: { select: { currency: true } },
        },
      },
      refunds: { select: { amountFiat: true } },
    },
  });
  const row = toListRow(full);
  const thread = await readThread(ticketId);
  // §51 — партнёр мог не настраивать компенсацию, и тогда её не предлагают.
  const compensationCampaign = await readCompensationCampaign(
    ticket.operatorId,
    ticket.pointId,
  );

  return (
    <div>
      <Link
        href={`/${locale}/me/charger-operator/${id}/tickets`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {t("title")}
      </Link>

      <h1 className="mt-4 text-[24px] font-bold">{tReport(`type.${ticket.problemType}`)}</h1>
      <p className="mt-1 text-[13px] text-muted">
        {full.point && (
          <>
            <Link href={`/${locale}/c/${full.point.id}`} prefetch={false} className="underline">
              {full.point.name}
            </Link>
            {full.point.city ? `, ${full.point.city}` : ""}
            {full.connector && <> · {full.connector.type}</>}
            {" · "}
          </>
        )}
        <span data-testid="ticket-status">{t(`status.${ticket.status}`)}</span>
        {row.awaitingAnswer && ticket.status !== "CLOSED" && (
          <> · {row.overdue ? t("overdue") : t("awaiting")}</>
        )}
        {row.escalated && <> · {t("escalated")}</>}
      </p>
      {full.reporter && (
        <p className="mt-0.5 text-[13px] text-muted">
          {t("reporter")}: @{full.reporter.username}
        </p>
      )}

      {full.workOrder && (
        <p className="mt-2 text-[13px]">
          <Link
            href={`/${locale}/me/work-orders/${full.workOrder.id}`}
            prefetch={false}
            className="text-accent underline"
          >
            {t("workOrder")}: {full.workOrder.title}
          </Link>
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

      {seen.canWrite && (
        <TicketCompensationPanel
          ticketId={ticket.id}
          session={
            full.payment
              ? {
                  pointName: full.payment.point?.name ?? null,
                  at: full.payment.capturedAt?.toISOString() ?? null,
                  chargedFiat: num(full.payment.amountFiat),
                  refundableFiat: roundMoney(
                    num(full.payment.amountFiat) -
                      full.refunds.reduce((sum, r) => sum + num(r.amountFiat), 0),
                  ),
                  currency: full.payment.zone.currency,
                  byCard: full.payment.cardId !== null,
                }
              : null
          }
          compensation={ticket.compensation}
          giftKwh={compensationCampaign ? num(compensationCampaign.giftKwh) : null}
          giftGiven={(ticket.compensation ?? "").includes("kWh")}
          labels={{
            heading: t("compensation.heading"),
            given: t("compensation.given"),
            session: t("compensation.session"),
            leftToRefund: t("compensation.leftToRefund"),
            amount: t("compensation.amount"),
            reason: t("compensation.reason"),
            refund: t("compensation.refund"),
            refunding: t("compensation.refunding"),
            compensate: t("compensation.compensate"),
            cardClosed: t("compensation.cardClosed"),
            noCampaign: t("compensation.noCampaign"),
            noSession: t("compensation.noSession"),
          }}
        />
      )}

      <TicketThread
        ticketId={ticket.id}
        messages={thread}
        canWrite={seen.canWrite}
        canResolve={seen.canWrite}
        closed={ticket.status === "CLOSED"}
        labels={threadLabels(t)}
      />
    </div>
  );
}
