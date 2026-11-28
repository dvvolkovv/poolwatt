// One work order — ТЗ §48, US-48: the address, how to find it, the fault,
// the parts to bring, the customer's photos, and the statuses.

import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WorkOrderPanel } from "@/components/work/work-order-panel";
import { WorkOrderSitePanel } from "@/components/work/work-order-site-panel";
import { readWorkOrderForUser } from "@/lib/work/work-order-access";
import { ensureChecklist, readChecklist } from "@/lib/work/work-order-checklist";
import { readSignature, readSitePhotos } from "@/lib/work/work-order-media";
import { readRoomMessages } from "@/lib/work/chat-service";
import { ChatThread } from "@/components/work/chat-thread";

export const dynamic = "force-dynamic";

export default async function WorkOrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/work-orders/${id}`);
  }

  const order = await prisma.workOrder.findUnique({
    where: { id },
    include: {
      point: {
        select: {
          id: true,
          name: true,
          city: true,
          country: true,
          addressLine: true,
          howToFind: true,
          latitude: true,
          longitude: true,
        },
      },
      asset: { select: { name: true, address: true } },
      operator: { select: { id: true, displayName: true, claimedById: true } },
      company: { select: { legalName: true, ownerUserId: true } },
      assignee: { select: { id: true, user: { select: { username: true } } } },
    },
  });
  if (!order) notFound();

  // Право на наряд — одно, в `work-order-access.ts`: §47 и тут, и в телефоне,
  // и в маршруте файла.
  const seen = await readWorkOrderForUser(order.id, session.user.id, session.user.role);
  if (!seen) notFound();
  const isOwner =
    order.operator?.claimedById === session.user.id ||
    order.company?.ownerUserId === session.user.id ||
    session.user.role === "ADMIN";

  // §48 — чек-лист создаётся при первом открытии наряда тем, кто в нём
  // работает: наряды в базе уже есть, и иначе §48 был бы выполнен только для
  // будущих.
  const tasks = seen.canWork ? await ensureChecklist(order.id) : await readChecklist(order.id);
  const strips = await readSitePhotos(order.id);
  const signature = await readSignature(order.id);

  const t = await getTranslations("workOrders");
  const tChat = await getTranslations("chat");

  // §48 «чат по каждому наряду». Право то же, что на сам наряд: сюда уже
  // дошли только те, кому `readWorkOrderForUser` сказал «да».
  const chat = await readRoomMessages(`wo-${order.id}`, session.user.id, session.user.role);

  const staff = order.operatorId
    ? await prisma.employee.findMany({
        where: { operatorId: order.operatorId, role: { permissions: { has: "workorders.write" } } },
        include: { user: { select: { username: true } } },
      })
    : [];

  return (
    <div>
      <Link
        href={`/${locale}/me/work-orders`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {t("title")}
      </Link>

      <h1 className="mt-4 text-[28px] font-bold">{order.title}</h1>
      <p className="mb-6 text-[13px] text-muted">
        {t(`type.${order.type}`)} · {t(`priority.${order.priority}`)} ·{" "}
        {t(`status.${order.status}`)}
      </p>

      <WorkOrderPanel
        order={{
          id: order.id,
          status: order.status,
          description: order.description,
          partsNeeded: order.partsNeeded,
          photos: order.photos,
          report: order.report,
          assigneeId: order.assigneeId,
          where: [order.point?.name ?? order.asset?.name, order.point?.addressLine, order.point?.city, order.point?.country]
            .filter(Boolean)
            .join(", "),
          howToFind: order.point?.howToFind ?? null,
          latitude: order.point?.latitude ?? null,
          longitude: order.point?.longitude ?? null,
        }}
        staff={staff.map((e) => ({ id: e.id, username: e.user.username }))}
        canAssign={isOwner}
        labels={{
          where: t("where"),
          howToFind: t("howToFind"),
          fault: t("fault"),
          parts: t("parts"),
          photos: t("photos"),
          report: t("report"),
          reportPlaceholder: t("reportPlaceholder"),
          assign: t("assign"),
          assignee: t("assignee"),
          route: t("route"),
          statusNames: {
            NEW: t("status.NEW"),
            ASSIGNED: t("status.ASSIGNED"),
            EN_ROUTE: t("status.EN_ROUTE"),
            IN_PROGRESS: t("status.IN_PROGRESS"),
            WAITING_PART: t("status.WAITING_PART"),
            DONE: t("status.DONE"),
            VERIFIED: t("status.VERIFIED"),
            CANCELLED: t("status.CANCELLED"),
          },
        }}
      />

      <WorkOrderSitePanel
        workOrderId={order.id}
        tasks={tasks}
        before={strips.before}
        after={strips.after}
        signature={signature}
        canWork={seen.canWork}
        labels={{
          checklist: t("checklist"),
          skip: t("skip"),
          skipReason: t("skipReason"),
          skipped: t("skipped"),
          save: t("save"),
          cancel: t("cancel"),
          photosBefore: t("photosBefore"),
          photosAfter: t("photosAfter"),
          noPhotos: t("noPhotos"),
          signature: t("signature"),
          noSignature: t("noSignature"),
          signedBy: t("signedBy"),
          signerSiteContact: t("signerSiteContact"),
          signerEngineer: t("signerEngineer"),
        }}
      />

      <ChatThread
        roomKey={`wo-${order.id}`}
        messages={chat}
        canWrite
        labels={{
          title: tChat("orderChat"),
          placeholder: tChat("placeholder"),
          send: tChat("send"),
          sending: tChat("sending"),
          system: tChat("system"),
          live: tChat("live"),
          empty: tChat("empty"),
          queued: tChat("queued"),
          offline: tChat("offline"),
        }}
      />
    </div>
  );
}
