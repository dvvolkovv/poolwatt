// Один наряд на телефоне — §48 и §49, US-49.
//
// Серверная часть здесь только читает: решение «мой наряд или нет» принимает
// `readEngineerStock`, а запись делает `POST /v1/stock-movements`, потому что
// запись должна пережить отсутствие связи, а серверное действие — не может.

import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readEngineerStock } from "@/lib/warehouse/engineer-view";
import { readWorkOrderForUser } from "@/lib/work/work-order-access";
import { ensureChecklist, readChecklist } from "@/lib/work/work-order-checklist";
import { readSignature, readSitePhotos } from "@/lib/work/work-order-media";
import { WorkOrderScreen } from "@/components/mobile/work-order-screen";

export const dynamic = "force-dynamic";

export default async function MobileWorkOrder({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/app/work-orders/${id}`);
  }

  const seen = await readWorkOrderForUser(id, session.user.id, session.user.role);
  if (!seen) notFound();

  // Снимок склада может быть пуст: право на наряд и право на склад §47 —
  // разные вещи, и инженер без `warehouse.write` всё равно работает наряд.
  const stock = (await readEngineerStock(id, session.user.id)) ?? {
    workOrderId: id,
    partsNeeded: [],
    warehouses: [],
    at: new Date().toISOString(),
  };

  // §48 — чек-лист создаётся при первом открытии наряда тем, кто в нём
  // работает: в базе уже лежат наряды, и иначе §48 был бы выполнен только
  // для будущих.
  const tasks = seen.canWork ? await ensureChecklist(id) : await readChecklist(id);
  const strips = await readSitePhotos(id);
  const signature = await readSignature(id);

  const order = await prisma.workOrder.findUniqueOrThrow({
    where: { id },
    include: {
      point: {
        select: {
          name: true,
          city: true,
          country: true,
          addressLine: true,
          howToFind: true,
        },
      },
      asset: { select: { name: true, address: true } },
    },
  });

  const t = await getTranslations("app.work");
  const tOrders = await getTranslations("workOrders");

  return (
    <WorkOrderScreen
      locale={locale}
      order={{
        id: order.id,
        title: order.title,
        description: order.description,
        status: order.status,
        meta: `${tOrders(`type.${order.type}`)} · ${tOrders(
          `priority.${order.priority}`,
        )} · ${tOrders(`status.${order.status}`)}`,
        where: [
          order.point?.name ?? order.asset?.name,
          order.point?.addressLine ?? order.asset?.address,
          order.point?.city,
          order.point?.country,
        ]
          .filter(Boolean)
          .join(", "),
        howToFind: order.point?.howToFind ?? null,
        photos: order.photos,
        partsNeeded: order.partsNeeded,
      }}
      stock={stock}
      site={{
        tasks,
        photos: [...strips.before, ...strips.after].map((p) => ({
          key: p.key,
          stage: p.stage,
        })),
        signature,
        canWork: seen.canWork,
      }}
      siteLabels={{
        checklist: t("checklist"),
        skip: t("skip"),
        skipReason: t("skipReason"),
        skipped: t("skipped"),
        save: t("save"),
        cancel: t("cancel"),
        photosBefore: t("photosBefore"),
        photosAfter: t("photosAfter"),
        addPhoto: t("addPhoto"),
        uploading: t("uploading"),
        photoNeedsNetwork: t("photoNeedsNetwork"),
        signature: t("signature"),
        signerName: t("signerName"),
        signerSiteContact: t("signerSiteContact"),
        signerEngineer: t("signerEngineer"),
        signHere: t("signHere"),
        clear: t("clear"),
        sign: t("sign"),
        signedBy: t("signedBy"),
        close: t("close"),
        closing: t("closing"),
        closed: t("closedNote"),
      }}
      labels={{
        title: t("title"),
        where: t("where"),
        howToFind: t("howToFind"),
        fault: t("fault"),
        parts: t("parts"),
        photos: t("photos"),
        issue: t("issue"),
        warehouse: t("warehouse"),
        mine: t("mine"),
        part: t("part"),
        nothingHere: t("nothingHere"),
        onShelf: t("onShelf"),
        qty: t("qty"),
        serial: t("serial"),
        note: t("note"),
        send: t("send"),
        snapshotAt: t("snapshotAt", { at: stock.at.slice(11, 16) }),
        queued: t("queued"),
        queuedHint: t("queuedHint"),
        sendNow: t("sendNow"),
        sending: t("sending"),
        rejected: t("rejected"),
        dismiss: t("dismiss"),
        offline: t("offline"),
      }}
    />
  );
}
