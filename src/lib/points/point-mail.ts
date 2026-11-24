// Point moderation notifications — ТЗ §29.4, US-24. Mail must never fail a
// form: both helpers log and return on error, like resend-listing.ts.

import { sendEmail } from "@/lib/email";
import { operatorEmail } from "@/lib/operator-email";
import { prisma } from "@/lib/prisma";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export async function sendPointSubmittedToAdmin(args: {
  pointId: string;
  name: string;
}): Promise<void> {
  const to = operatorEmail();
  if (!to) {
    console.warn("[point-mail] no ADMIN_EMAIL or EMAIL_REPLY_TO, skipping");
    return;
  }
  try {
    await sendEmail({
      to,
      subject: `[Poolwatt] Acceptance point for review — ${args.name}`,
      html: `
        <p>A point card is waiting for review.</p>
        <p><a href="${BASE}/en/admin/points/${args.pointId}">Open in admin</a></p>
      `,
    });
  } catch (err) {
    console.error("[point-mail] submitted notification failed", err);
  }
}

export async function sendPointDecisionToOwner(args: {
  pointId: string;
  name: string;
  approved: boolean;
  note: string | null;
}): Promise<void> {
  try {
    const point = await prisma.acceptancePoint.findUnique({
      where: { id: args.pointId },
      select: {
        operatorId: true,
        operator: {
          select: {
            email: true,
            claimedBy: { select: { email: true, emailVerified: true } },
          },
        },
      },
    });
    if (!point) return;

    const to = new Set<string>();
    const claimed = point.operator.claimedBy;
    if (claimed?.email && claimed.emailVerified) to.add(claimed.email);
    if (point.operator.email) to.add(point.operator.email);
    if (to.size === 0) return;

    const url = `${BASE}/en/me/charger-operator/${point.operatorId}/points/${args.pointId}`;
    for (const address of to) {
      await sendEmail({
        to: address,
        subject: `[Poolwatt] ${args.approved ? "Point approved" : "Point sent back"} — ${args.name}`,
        html: args.approved
          ? `<p>The point <b>${args.name}</b> passed review and is on test connection.</p>
             <p>It appears in the navigator as soon as its equipment reports for the first time.</p>
             <p><a href="${url}">Open the card</a></p>`
          : `<p>The point <b>${args.name}</b> was sent back.</p>
             <p>${args.note ?? ""}</p>
             <p><a href="${url}">Open the card</a></p>`,
      });
    }
  } catch (err) {
    console.error("[point-mail] decision notification failed", err);
  }
}
