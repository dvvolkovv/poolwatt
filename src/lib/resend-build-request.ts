import { sendEmail } from "@/lib/email";
import { emailLink, emailText } from "@/lib/email-i18n";
import { operatorEmail } from "@/lib/operator-email";
import { prisma } from "@/lib/prisma";
import type { BuildRequestStatus } from "@prisma/client";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export type AdminNotification = {
  id: string;
  source: string;
  peakKw: { toNumber(): number } | number;
  country: string;
};

export async function sendBuildRequestNewToAdmin(req: AdminNotification): Promise<void> {
  const to = operatorEmail();
  if (!to) {
    console.warn("[resend-build-request] no ADMIN_EMAIL or EMAIL_REPLY_TO, skipping operator notification");
    return;
  }

  const kw = typeof req.peakKw === "number" ? req.peakKw : req.peakKw.toNumber();
  const url = `${BASE}/admin/build-requests/${req.id}`;
  const shortId = req.id.slice(0, 8);

  await sendEmail({
    to,
    subject: `[Poolwatt] New build request #${shortId} — ${req.source} ${kw}kW, ${req.country}`,
    html: `
      <p>A new build request was filed.</p>
      <p>Source: <b>${req.source}</b>, peak: <b>${kw} kW</b>, country: <b>${req.country}</b></p>
      <p><a href="${url}">Open in admin</a></p>
    `,
  });
}

export async function sendBuildRequestStatusChangedToOwner(
  requestId: string,
  newStatus: BuildRequestStatus,
  ownerId: string,
): Promise<void> {
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { email: true, emailVerified: true, username: true, preferredLocale: true },
  });
  if (!owner?.email || !owner.emailVerified) {
    return;  // silent skip — owner has no verified email
  }

  const t = await emailText(owner.preferredLocale);
  const url = `${BASE}/${t.locale}/me/build-requests/${requestId}`;
  const vars = { id: requestId.slice(0, 8), status: t.text(`notify.buildStatusName.${newStatus}`) };

  await sendEmail({
    to: owner.email,
    subject: `[Poolwatt] ${t.text("notify.buildStatus.subject", vars)}`,
    html: t.layout(
      t.html("notify.hi", { name: owner.username }),
      t.html("notify.buildStatus.body", vars),
      ...emailLink(url, t.html("notify.buildStatus.cta")),
    ),
  });
}
