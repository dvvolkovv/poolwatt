// Listing notifications — ТЗ §12 US-01 ("оператор получает уведомление"),
// US-02 (the producer learns the decision and its comment).
//
// Mail must never fail a form: both helpers log and return on error, the way
// resend-build-request.ts does.

import { sendEmail } from "@/lib/email";
import { emailLink, emailText } from "@/lib/email-i18n";
import { operatorEmail } from "@/lib/operator-email";
import { prisma } from "@/lib/prisma";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export async function sendListingSubmittedToAdmin(args: {
  applicationId: string;
  legalName: string;
  country: string;
  type: string;
  documents: number;
}): Promise<void> {
  const to = operatorEmail();
  if (!to) {
    console.warn("[resend-listing] no ADMIN_EMAIL or EMAIL_REPLY_TO, skipping operator notification");
    return;
  }

  const url = `${BASE}/admin/listings/${args.applicationId}`;
  try {
    await sendEmail({
      to,
      subject: `[Poolwatt] Listing application — ${args.legalName} (${args.country}, ${args.type})`,
      html: `
        <p>A listing application is waiting for review.</p>
        <p>Company: <b>${args.legalName}</b>, country: <b>${args.country}</b>,
           type: <b>${args.type}</b>, documents: <b>${args.documents}</b></p>
        <p><a href="${url}">Open in admin</a></p>
      `,
    });
  } catch (err) {
    console.error("[resend-listing] submitted notification failed", err);
  }
}

export async function sendListingDecisionToOwner(args: {
  applicationId: string;
  ownerUserId: string | null;
  approved: boolean;
  comment: string | null;
}): Promise<void> {
  if (!args.ownerUserId) return;
  try {
    const owner = await prisma.user.findUnique({
      where: { id: args.ownerUserId },
      select: { email: true, emailVerified: true, username: true, preferredLocale: true },
    });
    if (!owner?.email || !owner.emailVerified) return;

    const t = await emailText(owner.preferredLocale);
    const vars = {
      id: args.applicationId.slice(0, 8),
      status: t.text(`notify.listingStatusName.${args.approved ? "APPROVED" : "REJECTED"}`),
    };
    const url = `${BASE}/${t.locale}/me/listing`;

    await sendEmail({
      to: owner.email,
      subject: `[Poolwatt] ${t.text("notify.listingDecision.subject", vars)}`,
      html: t.layout(
        t.html("notify.hi", { name: owner.username }),
        t.html("notify.listingDecision.body", vars),
        ...(args.comment ? [t.html("notify.listingDecision.comment", { comment: args.comment })] : []),
        ...emailLink(url, t.html("notify.listingDecision.cta")),
      ),
    });
  } catch (err) {
    console.error("[resend-listing] decision notification failed", err);
  }
}
