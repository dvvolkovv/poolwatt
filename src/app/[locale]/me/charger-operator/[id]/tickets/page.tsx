// The network's ticket queue — ТЗ §51, §48 (SLA).

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readOperatorQueueAccess } from "@/lib/work/ticket-access";
import { toListRow } from "@/lib/work/ticket-view";

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

  const access = await readOperatorQueueAccess(id, session.user.id, session.user.role);
  if (!access) notFound();

  const t = await getTranslations("tickets");
  const tReport = await getTranslations("report");

  const tickets = await prisma.ticket.findMany({
    where: {
      operatorId: id,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      // §47 — область сотрудника. Заявка о пункте, которого ему не выдали,
      // для него не существует; заявка без пункта — забота всей сети.
      ...(access.pointIds ? { OR: [{ pointId: { in: access.pointIds } }, { pointId: null }] } : {}),
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 100,
    include: {
      point: { select: { name: true, city: true } },
      reporter: { select: { username: true } },
      workOrder: { select: { id: true, title: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 50 },
    },
  });
  const now = new Date();
  const rows = tickets.map((ticket) => toListRow(ticket, now));

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

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-hairline" data-testid="ticket-queue">
          {rows.map((row) => (
            <li key={row.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/${locale}/me/charger-operator/${id}/tickets/${row.id}`}
                  prefetch={false}
                  className="text-sm underline hover:text-accent"
                  data-testid="ticket-link"
                >
                  {tReport(`type.${row.problemType}`)}
                  {row.pointName && <span className="text-muted"> · {row.pointName}</span>}
                </Link>
                <span
                  className={row.overdue ? "text-[12px] text-down" : "text-[12px] text-muted"}
                  data-overdue={row.overdue ? "yes" : "no"}
                >
                  {t(`status.${row.status}`)}
                  {row.awaitingAnswer && (
                    <>
                      {" · "}
                      {row.overdue ? t("overdue") : t("awaiting")}
                    </>
                  )}
                  {row.respondBy && (
                    <>
                      {" · "}
                      {t("respondBy")}{" "}
                      <span className="num">{row.respondBy.slice(11, 16)}</span>
                    </>
                  )}
                  {row.escalated && <> · {t("escalated")}</>}
                  {row.reporterName && <> · @{row.reporterName}</>}
                </span>
              </div>
              {row.lastMessage && (
                <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">
                  {row.lastMessage.body}
                </p>
              )}
              {row.workOrderId && (
                <Link
                  href={`/${locale}/me/work-orders/${row.workOrderId}`}
                  prefetch={false}
                  className="text-[12px] text-accent underline"
                >
                  {t("workOrder")}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
