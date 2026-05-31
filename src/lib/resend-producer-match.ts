import { Resend } from "resend";
import { prisma } from "@/lib/prisma";

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

export type ProducerInterestExpressedPayload = {
  claimId: string;
  buildRequestId: string;
  producerName: string;
  ownerUserId: string;
};

export async function sendProducerInterestExpressedToOwner(p: ProducerInterestExpressedPayload): Promise<void> {
  const owner = await prisma.user.findUnique({
    where: { id: p.ownerUserId },
    select: { email: true, emailVerified: true, username: true },
  });
  if (!owner?.email || !owner.emailVerified) return;

  const url = `${BASE}/en/me/build-requests/${p.buildRequestId}`;
  const shortId = p.buildRequestId.slice(0, 8);
  const c = client();
  if (!c) {
    console.log(`[resend stub] producer ${p.producerName} interested in BR ${shortId} → ${owner.email}: ${url}`);
    return;
  }
  await c.emails.send({
    from: FROM,
    to: owner.email,
    subject: `[Poolwatt] ${p.producerName} is interested in your build request #${shortId}`,
    html: `
      <p>Hi ${owner.username},</p>
      <p><b>${p.producerName}</b> (a verified producer) has expressed interest in your build request <b>#${shortId}</b>.</p>
      <p><a href="${url}">Review and accept</a></p>
    `,
  });
}

export type ProducerClaimAcceptedPayload = {
  claimId: string;
  buildRequestId: string;
  producerId: string;
};

export async function sendProducerClaimAcceptedToProducer(p: ProducerClaimAcceptedPayload): Promise<void> {
  const claim = await prisma.producerBuildRequestClaim.findUnique({
    where: { id: p.claimId },
    select: {
      producer: {
        select: {
          displayName: true,
          claimedBy: { select: { email: true, emailVerified: true, username: true } },
        },
      },
      buildRequest: {
        select: {
          user: { select: { name: true, phone: true, email: true } },
          city: true,
          country: true,
          addressLine: true,
          source: true,
          peakKw: true,
        },
      },
    },
  });
  if (!claim) return;
  const owner = claim.producer.claimedBy;
  if (!owner?.email || !owner.emailVerified) return;

  const shortId = p.buildRequestId.slice(0, 8);
  const url = `${BASE}/en/me/producer/${p.producerId}/requests`;
  const hw = claim.buildRequest.user;

  const cli = client();
  if (!cli) {
    console.log(`[resend stub] producer claim ${p.claimId} ACCEPTED — contact ${owner.email}`);
    return;
  }
  await cli.emails.send({
    from: FROM,
    to: owner.email,
    subject: `[Poolwatt] Your interest in request #${shortId} was accepted — contact details inside`,
    html: `
      <p>Hi ${owner.username},</p>
      <p>The homeowner accepted your interest in build request <b>#${shortId}</b>.</p>
      <h3>Contact details</h3>
      <ul>
        <li>Name: <b>${hw.name ?? "—"}</b></li>
        <li>Email: ${hw.email ?? "—"}</li>
        <li>Phone: ${hw.phone ?? "—"}</li>
        <li>Address: ${claim.buildRequest.addressLine}, ${claim.buildRequest.city}, ${claim.buildRequest.country}</li>
      </ul>
      <p>Project: ${claim.buildRequest.source}, ${claim.buildRequest.peakKw.toString()} kW peak.</p>
      <p><a href="${url}">Open your dashboard</a></p>
    `,
  });
}
