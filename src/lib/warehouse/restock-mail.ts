// US-50 — "Автоматическая заявка и уведомление."
//
// The request is raised inside the transaction that caused it (see
// `stock-service.maybeRaiseRestock`); telling somebody is the part that can
// fail, so it is kept out of that transaction and recorded on the request
// itself. `notifiedAt` null means somebody is still owed the news, and the
// worker sweep retries every minute — the same arrangement as a receipt.

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { emailLink, emailText } from "@/lib/email-i18n";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export interface RestockNotifyOptions {
  /** Injected by tests so no mail leaves the machine. */
  sendTo?: (to: string, subject: string, html: string) => Promise<void>;
  limit?: number;
}

const defaultSend = (to: string, subject: string, html: string) =>
  sendEmail({ to, subject, html });

/**
 * Who to tell about a store running low: the keeper of that store when it has
 * one (a van has its engineer), otherwise the person who owns the network.
 */
async function recipientFor(warehouseId: string): Promise<{
  email: string;
  locale: string | null;
} | null> {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    include: {
      keeperEmployee: {
        include: { user: { select: { email: true, emailVerified: true, preferredLocale: true } } },
      },
      operator: {
        select: {
          email: true,
          claimedBy: { select: { email: true, emailVerified: true, preferredLocale: true } },
        },
      },
    },
  });
  if (!warehouse) return null;

  const keeper = warehouse.keeperEmployee?.user;
  if (keeper?.email && keeper.emailVerified) {
    return { email: keeper.email, locale: keeper.preferredLocale };
  }
  const owner = warehouse.operator.claimedBy;
  if (owner?.email && owner.emailVerified) {
    return { email: owner.email, locale: owner.preferredLocale };
  }
  if (warehouse.operator.email) {
    return { email: warehouse.operator.email, locale: null };
  }
  return null;
}

/** Tell one keeper about one request. Never throws. */
export async function notifyRestockRequest(
  requestId: string,
  options: RestockNotifyOptions = {},
): Promise<boolean> {
  const send = options.sendTo ?? defaultSend;

  try {
    const request = await prisma.restockRequest.findUnique({
      where: { id: requestId },
      include: { warehouse: { select: { id: true, name: true, operatorId: true } } },
    });
    if (!request || request.notifiedAt || request.status !== "OPEN") return false;

    const part = await prisma.sparePart.findUnique({
      where: { id: request.partId },
      select: { name: true, sku: true },
    });

    const to = await recipientFor(request.warehouse.id);
    if (!to) {
      // Nobody to tell: mark it done rather than sweep it forever.
      await prisma.restockRequest.update({
        where: { id: request.id },
        data: { notifiedAt: new Date() },
      });
      return false;
    }

    const t = await emailText(to.locale);
    const subject = t.text("restock.subject", {
      part: part?.name ?? request.partId,
      warehouse: request.warehouse.name,
    });
    const html = t.layout(
      t.html("restock.body", {
        part: part?.name ?? request.partId,
        sku: part?.sku ?? "—",
        warehouse: request.warehouse.name,
        qty: String(request.qtyAtRequest),
        min: String(request.minQty),
        suggested: String(request.suggestedQty),
      }),
      ...emailLink(
        `${BASE}/${t.locale}/me/charger-operator/${request.warehouse.operatorId}/warehouse`,
        t.html("restock.cta"),
      ),
    );

    await send(to.email, subject, html);
    await prisma.restockRequest.update({
      where: { id: request.id },
      data: { notifiedAt: new Date() },
    });
    return true;
  } catch (err) {
    console.error("[restock] notification failed for", requestId, err);
    return false;
  }
}

/** The sweep that makes US-50's "уведомление" true even when mail was down. */
export async function notifyPendingRestockRequests(
  options: RestockNotifyOptions = {},
): Promise<number> {
  const pending = await prisma.restockRequest.findMany({
    where: { notifiedAt: null, status: "OPEN" },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 200,
    select: { id: true },
  });

  let told = 0;
  for (const row of pending) {
    if (await notifyRestockRequest(row.id, options)) told += 1;
  }
  return told;
}
