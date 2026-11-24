// The network's ticket queue — ТЗ §51, §48 (SLA).

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, readEmployee } from "@/lib/staff/staff-service";

export const dynamic = "force-dynamic";

export default async function TicketsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/tickets`);
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true, claimedById: true },
  });
  if (!operator) notFound();

  const isOwner =
    operator.claimedById === session.user.id || session.user.role === "ADMIN";
  if (!isOwner) {
    const employee = await readEmployee(id, session.user.id);
    if (!employee || !can(employee, "tickets.read")) notFound();
  }

  const t = await getTranslations("tickets");
  const tReport = await getTranslations("report");

  const tickets = await prisma.ticket.findMany({
    where: { operatorId: id, status: { in: ["OPEN", "IN_PROGRESS"] } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 100,
    include: {
      point: { select: { name: true, city: true } },
      reporter: { select: { username: true } },
      workOrder: { select: { id: true, title: true } },
    },
  });

  return (
    <div>
      <Link
        href={`/${locale}/me/charger-operator/${id}`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {operator.displayName}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">
        {t("eyebrow")}
      </div>
      <h1 className="mb-6 text-[28px] font-bold">{t("title")}</h1>

      {tickets.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-hairline" data-testid="ticket-queue">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm">
                  {tReport(`type.${ticket.problemType}`)}
                  {ticket.point && <span className="text-muted"> · {ticket.point.name}</span>}
                </span>
                <span className="text-[12px] text-muted">
                  {t(`status.${ticket.status}`)}
                  {ticket.respondBy && (
                    <>
                      {" · "}
                      {t("respondBy")}{" "}
                      <span className="num">
                        {ticket.respondBy.toISOString().slice(11, 16)}
                      </span>
                    </>
                  )}
                  {ticket.reporter && <> · @{ticket.reporter.username}</>}
                </span>
              </div>
              {ticket.comment && (
                <p className="mt-0.5 text-[13px] text-muted">{ticket.comment}</p>
              )}
              {ticket.workOrder && (
                <Link
                  href={`/${locale}/me/work-orders/${ticket.workOrder.id}`}
                  prefetch={false}
                  className="text-[12px] text-accent underline"
                >
                  {t("workOrder")}: {ticket.workOrder.title}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
