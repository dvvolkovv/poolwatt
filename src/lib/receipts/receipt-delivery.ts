// §46 "Доставка чека" and US-45 — "чек формируется в течение минуты после
// зарядки".
//
// Forming the receipt is instant: it is written inside the same transaction as
// the payment. Delivery is the part that can fail, so it is kept out of that
// transaction and recorded on the receipt itself: `deliveredAt` null means
// somebody is still owed this document, and the worker sweep retries every
// minute. That is what makes the minute true even when the mail server is
// down for thirty seconds.
//
// Push is behind `pushOpen()` — APNs and FCM keys are the owner's to obtain.
// A closed gate costs the driver nothing: the letter and the wallet page are
// the same document.

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { emailText, escapeHtml } from "@/lib/email-i18n";
import { pushOpen } from "@/lib/exchange/gates";
import { buildReceiptDocument, type ReceiptDocument } from "./receipt-document";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export interface DeliveryOptions {
  /** Injected by tests so no mail leaves the machine. */
  sendTo?: (to: string, subject: string, html: string) => Promise<void>;
  /** Overrides the push gate, for tests. */
  pushIsOpen?: boolean;
}

export interface DeliveryResult {
  channels: string[];
}

const defaultSend = (to: string, subject: string, html: string) =>
  sendEmail({ to, subject, html });

/**
 * Deliver one receipt by whatever channels its owner chose.
 *
 * Never throws: it is called from the payment path, and a receipt that could
 * not be mailed must not undo a charge that already happened. A failure is
 * written down and left owing.
 */
export async function deliverReceipt(
  receiptId: string,
  options: DeliveryOptions = {},
): Promise<DeliveryResult> {
  const send = options.sendTo ?? defaultSend;

  try {
    const receipt = await prisma.receipt.findUnique({
      where: { id: receiptId },
      select: {
        id: true,
        number: true,
        deliveredAt: true,
        breakdown: true,
        payment: { select: { wallet: { select: { owner: recipientSelect } } } },
        reservation: { select: { user: recipientSelect } },
        trade: {
          select: {
            buyOrder: { select: { wallet: { select: { owner: recipientSelect } } } },
          },
        },
      },
    });
    if (!receipt) return { channels: [] };
    // Already told: a second attempt would be a second letter for one charge.
    if (receipt.deliveredAt) return { channels: [] };

    const user =
      receipt.payment?.wallet.owner ??
      receipt.reservation?.user ??
      receipt.trade?.buyOrder.wallet.owner ??
      null;

    // §46 names four channels, and the cabinet is one of them. An exchange
    // fill is settled in the wallet the moment it happens, and a trader
    // filling twenty orders is not asking for twenty letters — so a trade
    // receipt is delivered to the cabinet and nowhere else. A charge and a
    // booking are what US-45 is about, and those go out by mail.
    //
    // Same for a receipt with nobody to write to: it exists in the cabinet,
    // and chasing it every minute forever would be a loop, not a delivery.
    const kind = (receipt.breakdown as Record<string, unknown> | null)?.kind;
    if (!user || kind === "trade" || (receipt.trade && !receipt.payment && !receipt.reservation)) {
      await prisma.receipt.update({
        where: { id: receipt.id },
        data: { deliveredAt: new Date(), deliveryChannels: ["wallet"], deliveryError: null },
      });
      return { channels: ["wallet"] };
    }

    const channels: string[] = [];
    const wantsEmail = user.receiptEmail && Boolean(user.email) && Boolean(user.emailVerified);

    if (wantsEmail) {
      const doc = await buildReceiptDocument(receipt.id);
      if (doc) {
        const mail = await receiptEmail(doc, user.preferredLocale);
        await send(user.email!, mail.subject, mail.html);
        channels.push("email");
      }
    }

    // §25 — push needs keys only the owner can obtain (gates.pushOpen).
    const push = options.pushIsOpen ?? pushOpen();
    if (user.receiptPush && push) {
      await sendPush(user.id, receipt.number ?? receipt.id);
      channels.push("push");
    }

    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { deliveredAt: new Date(), deliveryChannels: channels, deliveryError: null },
    });
    return { channels };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Left owing on purpose: the worker tries again next minute.
    await prisma.receipt
      .update({ where: { id: receiptId }, data: { deliveryError: message.slice(0, 500) } })
      .catch(() => {});
    console.error(`[receipts] delivery failed for ${receiptId}`, err);
    return { channels: [] };
  }
}

const recipientSelect = {
  select: {
    id: true,
    email: true,
    emailVerified: true,
    preferredLocale: true,
    receiptEmail: true,
    receiptPush: true,
  },
} as const;

/**
 * Everything still owed a notification — the worker's minute job. A receipt
 * older than a week is not chased any more: by then the driver has seen it in
 * the wallet, and a letter about last Tuesday's charge is noise.
 */
export async function notifyPendingReceipts(
  options: DeliveryOptions & { limit?: number; now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const pending = await prisma.receipt.findMany({
    where: { deliveredAt: null, issuedAt: { gte: since } },
    orderBy: { issuedAt: "asc" },
    take: options.limit ?? 200,
    select: { id: true },
  });

  let delivered = 0;
  for (const row of pending) {
    const result = await deliverReceipt(row.id, options);
    if (result.channels.length > 0) delivered += 1;
  }
  return delivered;
}

/** The letter — §46 item 1: the network's logo above its own document. */
export async function receiptEmail(
  doc: ReceiptDocument,
  locale: string | null,
): Promise<{ subject: string; html: string }> {
  const t = await emailText(locale);
  const number = doc.number ?? doc.id;
  const url = `${BASE}/${t.locale}/me/wallet/receipts/${doc.id}`;

  const kindKey =
    doc.kind === "charge"
      ? "receipt.kindCharge"
      : doc.kind === "trade"
        ? "receipt.kindTrade"
        : doc.kind === "reservation.no_show"
          ? "receipt.kindNoShow"
          : "receipt.kindOther";

  const subject = t.text("receipt.subject", { number, kind: t.text(kindKey) });

  const logo =
    doc.network?.logoUrl
      ? `<p><img src="${escapeHtml(doc.network.logoUrl)}" alt="${escapeHtml(doc.network.displayName)}" height="40" /></p>`
      : "";
  const networkLine = doc.network
    ? `<p><b>${escapeHtml(doc.network.displayName)}</b>${
        doc.network.legalName ? `<br/>${escapeHtml(doc.network.legalName)}` : ""
      }${doc.network.vatNumber ? `<br/>${t.html("receipt.vatNumber")} ${escapeHtml(doc.network.vatNumber)}` : ""}</p>`
    : "";
  const sessionLine = doc.session?.pointName
    ? `<p>${t.html("receipt.point")}: ${escapeHtml(doc.session.pointName)}${
        doc.session.connector ? ` · ${escapeHtml(doc.session.connector)}` : ""
      }</p>`
    : "";
  const vatLine = doc.vat
    ? `<p>${t.html("receipt.vat")} ${doc.vat.ratePct.toFixed(2)} %: ${doc.vat.amount.toFixed(2)} ${doc.currency}</p>`
    : `<p>${t.html("receipt.vat")}: ${t.html("receipt.vatNotStated")}</p>`;

  const html = t.layout(
    t.html("greeting"),
    t.html("receipt.body", { number, kind: t.text(kindKey) }),
  ) +
    logo +
    networkLine +
    sessionLine +
    `<p>${t.html("receipt.kwh")}: <b>${doc.totalKwh.toFixed(3)} kWh</b><br/>` +
    `${t.html("receipt.total")}: <b>${doc.totalFiat.toFixed(2)} ${doc.currency}</b></p>` +
    vatLine +
    `<p><a href="${escapeHtml(url)}">${t.html("receipt.cta")}</a></p>` +
    (doc.verifyUrl
      ? `<p>${t.html("receipt.qrHint")}: <a href="${escapeHtml(doc.verifyUrl)}">${escapeHtml(doc.verifyUrl)}</a></p>`
      : "");

  return { subject, html };
}

/** Reached only once the owner supplies APNs and FCM keys (gates.pushOpen). */
async function sendPush(userId: string, number: string): Promise<void> {
  console.warn(`[receipts] push is open but no provider is wired yet: ${userId} ${number}`);
}
