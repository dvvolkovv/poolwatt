// §41 moderation notifications — the partner has to learn the decision without
// sitting on the page, and the operator has to learn there is a queue. Mail
// must never fail a form: both helpers log and return on error, like
// `points/point-mail.ts`.

import { sendEmail } from "@/lib/email";
import { operatorEmail } from "@/lib/operator-email";
import { prisma } from "@/lib/prisma";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export async function sendContentSubmittedToOperator(contentId: string): Promise<void> {
  const to = operatorEmail();
  if (!to) {
    console.warn("[content-mail] no ADMIN_EMAIL or EMAIL_REPLY_TO, skipping");
    return;
  }
  try {
    const content = await prisma.marketingContent.findUnique({
      where: { id: contentId },
      select: { title: true, type: true, operator: { select: { displayName: true } } },
    });
    if (!content) return;

    await sendEmail({
      to,
      subject: `[Poolwatt] Partner content for review — ${content.operator.displayName}`,
      html: `
        <p>${content.operator.displayName} submitted ${content.type.toLowerCase()} content for review.</p>
        <p><strong>${content.title}</strong></p>
        <p><a href="${BASE}/en/admin/marketing">Open the queue</a></p>
      `,
    });
  } catch (err) {
    console.error("[content-mail] submitted notification failed", err);
  }
}

export async function sendContentDecisionToPartner(args: {
  contentId: string;
  approved: boolean;
  note: string | null;
}): Promise<void> {
  try {
    const content = await prisma.marketingContent.findUnique({
      where: { id: args.contentId },
      select: {
        title: true,
        operatorId: true,
        operator: {
          select: {
            email: true,
            claimedBy: { select: { email: true, emailVerified: true } },
          },
        },
      },
    });
    if (!content) return;

    const to = new Set<string>();
    const claimed = content.operator.claimedBy;
    if (claimed?.email && claimed.emailVerified) to.add(claimed.email);
    if (content.operator.email) to.add(content.operator.email);
    if (to.size === 0) return;

    const url = `${BASE}/en/me/charger-operator/${content.operatorId}/marketing`;
    await sendEmail({
      to: [...to].join(", "),
      subject: args.approved
        ? `[Poolwatt] "${content.title}" is published`
        : `[Poolwatt] "${content.title}" was not approved`,
      html: `
        <p>${
          args.approved
            ? "Your content is approved and will show inside its schedule."
            : "Your content was not approved."
        }</p>
        <p><strong>${content.title}</strong></p>
        ${args.note ? `<p>Reason: ${args.note}</p>` : ""}
        <p><a href="${url}">Open the marketing page</a></p>
      `,
    });
  } catch (err) {
    console.error("[content-mail] decision notification failed", err);
  }
}
