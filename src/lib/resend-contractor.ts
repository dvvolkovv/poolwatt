import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import type { ContractorStatus } from "@prisma/client";

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

export type ContractorSummary = {
  id: string;
  slug?: string;
  displayName: string;
  country: string;
  entityType: string;
};

export async function sendContractorNewToAdmin(c: ContractorSummary): Promise<void> {
  const to = process.env.ADMIN_EMAIL;
  if (!to) {
    console.warn("[resend-contractor] ADMIN_EMAIL not set, skipping new-contractor notification");
    return;
  }
  const url = `${BASE}/admin/contractors/${c.id}`;
  const shortId = c.id.slice(0, 8);
  const r = client();
  if (!r) {
    console.log(`[resend stub] new contractor ${shortId} → ${to}: ${url}`);
    return;
  }
  await r.emails.send({
    from: FROM,
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
    select: { email: true, emailVerified: true, username: true },
  });
  if (!owner?.email || !owner.emailVerified) {
    return;  // silent skip — no verified email
  }
  const url = `${BASE}/me/contractor/${contractorId}`;
  const shortId = contractorId.slice(0, 8);
  const r = client();
  if (!r) {
    console.log(`[resend stub] contractor ${shortId} → ${newStatus} for ${owner.email}: ${url}`);
    return;
  }
  await r.emails.send({
    from: FROM,
    to: owner.email,
    subject: `[Poolwatt] Your contractor registration #${shortId} is now ${newStatus}`,
    html: `
      <p>Hi ${owner.username},</p>
      <p>Your contractor registration <b>#${shortId}</b> changed status to <b>${newStatus}</b>.</p>
      <p><a href="${url}">View your registration</a></p>
    `,
  });
}

export async function sendContractorWithdrawnToAdmin(c: ContractorSummary): Promise<void> {
  const to = process.env.ADMIN_EMAIL;
  if (!to) {
    console.warn("[resend-contractor] ADMIN_EMAIL not set, skipping withdraw notification");
    return;
  }
  const shortId = c.id.slice(0, 8);
  const r = client();
  if (!r) {
    console.log(`[resend stub] contractor ${shortId} withdrawn → ${to}`);
    return;
  }
  await r.emails.send({
    from: FROM,
    to,
    subject: `[Poolwatt] Contractor registration #${shortId} withdrawn`,
    html: `<p>Owner withdrew the registration for <b>${c.displayName}</b> (${c.country}). The DB row has been deleted.</p>`,
  });
}
