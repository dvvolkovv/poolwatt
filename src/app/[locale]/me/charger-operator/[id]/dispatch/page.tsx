// Рабочее место диспетчера сети — ТЗ §48.
//
// Доступ здесь не проверяется отдельной веткой: `readDispatchBoard` отвечает
// `null` и чужому, и сотруднику без права читать наряды, а право назначать
// приходит в `canAssign` — читающий диспетчер видит ту же очередь без кнопок.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readDispatchBoard, readTeamLoad } from "@/lib/work/assignment";
import { DispatchBoard, type DispatchLabels } from "@/components/work/dispatch-board";

export const dynamic = "force-dynamic";

export default async function DispatchPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/dispatch`);
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true },
  });
  if (!operator) notFound();

  const board = await readDispatchBoard(id, session.user.id);
  if (!board) notFound();
  const load = (await readTeamLoad(id, session.user.id)) ?? [];

  const points = await prisma.acceptancePoint.findMany({
    where: { operatorId: id },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true, city: true },
  });

  const t = await getTranslations("dispatch");
  const tOrders = await getTranslations("workOrders");

  const labels: DispatchLabels = {
    queue: t("queue"),
    unassigned: t("unassigned"),
    assign: t("assign"),
    assignee: tOrders("assignee"),
    candidatesEmpty: t("candidatesEmpty"),
    load: t("load"),
    loadOpen: t("loadOpen"),
    loadRegions: t("loadRegions"),
    wholeNetwork: t("wholeNetwork"),
    reason: {
      city: t("reason.city"),
      network: t("reason.network"),
      region: t("reason.region"),
    },
    statusNames: {
      NEW: tOrders("status.NEW"),
      ASSIGNED: tOrders("status.ASSIGNED"),
      EN_ROUTE: tOrders("status.EN_ROUTE"),
      IN_PROGRESS: tOrders("status.IN_PROGRESS"),
      WAITING_PART: tOrders("status.WAITING_PART"),
      DONE: tOrders("status.DONE"),
      VERIFIED: tOrders("status.VERIFIED"),
      CANCELLED: tOrders("status.CANCELLED"),
    },
    typeNames: {
      INSTALL: tOrders("type.INSTALL"),
      MAINTENANCE: tOrders("type.MAINTENANCE"),
      REPAIR: tOrders("type.REPAIR"),
      COMPLAINT_CHECK: tOrders("type.COMPLAINT_CHECK"),
    },
    priorityNames: {
      LOW: tOrders("priority.LOW"),
      NORMAL: tOrders("priority.NORMAL"),
      HIGH: tOrders("priority.HIGH"),
      URGENT: tOrders("priority.URGENT"),
    },
    create: t("create.title"),
    createTitle: t("create.name"),
    createDescription: t("create.description"),
    createPoint: t("create.point"),
    createType: t("create.type"),
    createPriority: t("create.priority"),
    createParts: t("create.parts"),
    createPartsHint: t("create.partsHint"),
    createSubmit: t("create.submit"),
    created: t("create.done"),
    empty: tOrders("empty"),
    age: t("age"),
    crew: t("crew"),
    engineer: t("engineer"),
  };

  return (
    <div className="max-w-3xl">
      <Link
        href={`/${locale}/me/charger-operator/${id}`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {operator.displayName}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-6 text-[28px] font-bold">{t("title")}</h1>

      <DispatchBoard
        operatorId={id}
        rows={board.rows}
        load={load}
        points={points}
        canAssign={board.canAssign}
        labels={labels}
      />
    </div>
  );
}
