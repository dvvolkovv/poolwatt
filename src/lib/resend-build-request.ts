import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import type { BuildRequestStatus } from "@prisma/client";

const FROM = "Poolwatt <noreply@poolwatt.com>";
const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

let cachedClient: Resend | null = null;
function client(): Resend | null {
  if (cachedClient) return cachedClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cachedClient = new Resend(key);
  return cachedClient;
}

export type AdminNotification = {
  id: string;
  source: string;
  peakKw: { toNumber(): number } | number;
  country: string;
};

export async function sendBuildRequestNewToAdmin(req: AdminNotification): Promise<void> {
  const to = process.env.ADMIN_EMAIL;
  if (!to) {
    console.warn("[resend-build-request] ADMIN_EMAIL not set, skipping new-request notification");
    return;
  }

  const c = client();
  const kw = typeof req.peakKw === "number" ? req.peakKw : req.peakKw.toNumber();
  const url = `${BASE}/admin/build-requests/${req.id}`;
  const shortId = req.id.slice(0, 8);

  if (!c) {
    console.log(`[resend stub] new build request ${shortId} → ${to}: ${url}`);
    return;
  }
  await c.emails.send({
    from: FROM,
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
    select: { email: true, emailVerified: true, username: true },
  });
  if (!owner?.email || !owner.emailVerified) {
    return;  // silent skip — owner has no verified email
  }

  const c = client();
  const url = `${BASE}/me/build-requests/${requestId}`;
  const shortId = requestId.slice(0, 8);

  if (!c) {
    console.log(`[resend stub] status change ${shortId} → ${newStatus} for ${owner.email}: ${url}`);
    return;
  }
  await c.emails.send({
    from: FROM,
    to: owner.email,
    subject: `[Poolwatt] Your build request #${shortId} is now ${newStatus}`,
    html: `
      <p>Hi ${owner.username},</p>
      <p>Your build request <b>#${shortId}</b> changed status to <b>${newStatus}</b>.</p>
      <p><a href="${url}">View your request</a></p>
    `,
  });
}
