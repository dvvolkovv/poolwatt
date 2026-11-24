// An engineer's work orders — ТЗ §48, US-48. The mobile app of §25 is still
// an open question, so "в приложении" is this page today.

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const OPEN = ["NEW", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "WAITING_PART", "DONE"] as const;

export default async function WorkOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/work-orders`);
  const userId = session.user.id;

  const t = await getTranslations("workOrders");

  // Mine as an engineer, mine as the owner of the network or the company.
  const orders = await prisma.workOrder.findMany({
    where: {
      status: { in: OPEN as unknown as string[] as never },
      OR: [
        { assignee: { userId } },
        { operator: { claimedById: userId } },
        { company: { ownerUserId: userId } },
      ],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 100,
    include: {
      point: { select: { name: true, city: true, addressLine: true } },
      asset: { select: { name: true } },
      assignee: { select: { user: { select: { username: true } } } },
    },
  });

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-6 text-[28px] font-bold">{t("title")}</h1>

      {orders.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-hairline" data-testid="work-order-list">
          {orders.map((o) => (
            <li key={o.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/${locale}/me/work-orders/${o.id}`}
                  prefetch={false}
                  className="text-sm underline hover:text-accent"
                >
                  {o.title}
                </Link>
                <span className="text-[12px] text-muted">
                  {t(`priority.${o.priority}`)} · {t(`status.${o.status}`)}
                  {o.assignee && <> · @{o.assignee.user.username}</>}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-muted">
                {[o.point?.name ?? o.asset?.name, o.point?.addressLine, o.point?.city]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
