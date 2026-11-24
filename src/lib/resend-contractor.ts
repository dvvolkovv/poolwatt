import { sendEmail } from "@/lib/email";
import { emailLink, emailText } from "@/lib/email-i18n";
import { operatorEmail } from "@/lib/operator-email";
import { prisma } from "@/lib/prisma";
import type { ContractorStatus } from "@prisma/client";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export type ContractorSummary = {
  id: string;
  slug?: string;
  displayName: string;
  country: string;
  entityType: string;
};

export async function sendContractorNewToAdmin(c: ContractorSummary): Promise<void> {
  const to = operatorEmail();
  if (!to) {
    console.warn("[resend-contractor] no ADMIN_EMAIL or EMAIL_REPLY_TO, skipping new-contractor notification");
    return;
  }
  const url = `${BASE}/admin/contractors/${c.id}`;
  const shortId = c.id.slice(0, 8);
  await sendEmail({
    to,
    subject: `[Poolwatt] New contractor registration #${shortId} — ${c.displayName}, ${c.country}`,
    html: `
      <p>A new contractor registration was filed.</p>
      <p>Name: <b>${c.displayName}</b><br>
         Type: <b>${c.entityType}</b><br>
         Country: <b>${c.country}</b></p>
      <p><a href="${url}">Open in admin</a></p>
    `,
  });
}

export async function sendContractorStatusChangedToOwner(
  contractorId: string,
  newStatus: ContractorStatus,
  ownerUserId: string,
): Promise<void> {
  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId },
    select: { email: true, emailVerified: true, username: true, preferredLocale: true },
  });
  if (!owner?.email || !owner.emailVerified) {
    return;  // silent skip — no verified email
  }
  const t = await emailText(owner.preferredLocale);
  const url = `${BASE}/${t.locale}/me/contractor/${contractorId}`;
  const vars = { id: contractorId.slice(0, 8), status: t.text(`notify.contractorStatusName.${newStatus}`) };

  await sendEmail({
    to: owner.email,
    subject: `[Poolwatt] ${t.text("notify.contractorStatus.subject", vars)}`,
    html: t.layout(
      t.html("notify.hi", { name: owner.username }),
      t.html("notify.contractorStatus.body", vars),
      ...emailLink(url, t.html("notify.contractorStatus.cta")),
    ),
  });
}

export async function sendContractorWithdrawnToAdmin(c: ContractorSummary): Promise<void> {
  const to = operatorEmail();
  if (!to) {
    console.warn("[resend-contractor] no ADMIN_EMAIL or EMAIL_REPLY_TO, skipping withdraw notification");
    return;
  }
  const shortId = c.id.slice(0, 8);
  await sendEmail({
    to,
    subject: `[Poolwatt] Contractor registration #${shortId} withdrawn`,
    html: `<p>Owner withdrew the registration for <b>${c.displayName}</b> (${c.country}). The DB row has been deleted.</p>`,
  });
}
