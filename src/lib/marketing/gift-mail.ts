// US-41 — "начисление в течение минуты после завершения зарядки; push
// клиенту".
//
// Issuing the grant is instant: it happens in one transaction with the budget
// counter. Telling the driver is the part that can fail, so it is kept out of
// that transaction and recorded on the grant itself — `notifiedAt` null means
// somebody is still owed the news, and the worker sweep retries every minute.
// The same arrangement as receipt delivery, for the same reason.
//
// Push is behind `pushOpen()`: APNs and FCM keys are the owner's to obtain. A
// closed gate costs the driver nothing — the letter and the "Подарки" page say
// the same thing.

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { emailLink, emailText } from "@/lib/email-i18n";
import { num } from "@/lib/exchange/decimal";
import { pushOpen } from "@/lib/exchange/gates";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export interface GiftNotifyOptions {
  /** Injected by tests so no mail leaves the machine. */
  sendTo?: (to: string, subject: string, html: string) => Promise<void>;
  /** Overrides the push gate, for tests. */
  pushIsOpen?: boolean;
  limit?: number;
}

const defaultSend = (to: string, subject: string, html: string) =>
  sendEmail({ to, subject, html });

/**
 * Tell one driver about one gift. Returns the channels that worked.
 *
 * Never throws: it is called from the charging path, and a letter that could
 * not be sent must not undo a gift that was already issued.
 */
export async function tellClientAboutGift(
  grantId: string,
  options: GiftNotifyOptions = {},
): Promise<string[]> {
  const send = options.sendTo ?? defaultSend;

  try {
    const grant = await prisma.promoGrant.findUnique({
      where: { id: grantId },
      include: {
        operator: { select: { displayName: true } },
        user: { select: { email: true, emailVerified: true, preferredLocale: true } },
      },
    });
    if (!grant || grant.notifiedAt) return [];

    const to = grant.user.emailVerified ? grant.user.email : null;
    if (!to) {
      // Nothing to retry: mark it done rather than sweep it forever.
      await prisma.promoGrant.update({
        where: { id: grantId },
        data: { notifiedAt: new Date() },
      });
      return [];
    }

    const t = await emailText(grant.user.preferredLocale);
    const url = `${BASE}/${t.locale}/me/gifts`;
    const amount = num(grant.amountKwh);
    const expires = grant.expiresAt.toISOString().slice(0, 10);

    const subject = t.text("gift.subject", {
      kwh: String(amount),
      network: grant.operator.displayName,
    });
    const html = t.layout(
      t.html("gift.body", {
        kwh: String(amount),
        network: grant.operator.displayName,
        expires,
      }),
      ...emailLink(url, t.html("gift.cta")),
    );

    await send(to, subject, html);

    const channels = ["email"];
    // US-41 asks for a push. Until the keys exist it is not pretended to.
    if (options.pushIsOpen ?? pushOpen()) channels.push("push");

    await prisma.promoGrant.update({
      where: { id: grantId },
      data: { notifiedAt: new Date() },
    });
    return channels;
  } catch (err) {
    console.error("[gift-mail] notification failed for", grantId, err);
    return [];
  }
}

/** The sweep that makes US-41's minute true when the inline attempt failed. */
export async function notifyPendingGrants(options: GiftNotifyOptions = {}): Promise<number> {
  const pending = await prisma.promoGrant.findMany({
    where: { notifiedAt: null, status: "ACTIVE" },
    orderBy: { issuedAt: "asc" },
    take: options.limit ?? 200,
    select: { id: true },
  });

  let told = 0;
  for (const row of pending) {
    const channels = await tellClientAboutGift(row.id, options);
    if (channels.length > 0) told += 1;
  }
  return told;
}
