import { sendEmail } from "@/lib/email";
import { emailLink, emailText, escapeHtml } from "@/lib/email-i18n";
import { prisma } from "@/lib/prisma";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export type ProducerInterestExpressedPayload = {
  claimId: string;
  buildRequestId: string;
  producerName: string;
  ownerUserId: string;
};

export async function sendProducerInterestExpressedToOwner(p: ProducerInterestExpressedPayload): Promise<void> {
  const owner = await prisma.user.findUnique({
    where: { id: p.ownerUserId },
    select: { email: true, emailVerified: true, username: true, preferredLocale: true },
  });
  if (!owner?.email || !owner.emailVerified) return;

  const t = await emailText(owner.preferredLocale);
  const url = `${BASE}/${t.locale}/me/build-requests/${p.buildRequestId}`;
  const vars = { id: p.buildRequestId.slice(0, 8), company: p.producerName };

  await sendEmail({
    to: owner.email,
    subject: `[Poolwatt] ${t.text("notify.interest.subject", vars)}`,
    html: t.layout(
      t.html("notify.hi", { name: owner.username }),
      t.html("notify.interest.producer", vars),
      ...emailLink(url, t.html("notify.interest.cta")),
    ),
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
          claimedBy: { select: { email: true, emailVerified: true, username: true, preferredLocale: true } },
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

  const t = await emailText(owner.preferredLocale);
  const vars = { id: p.buildRequestId.slice(0, 8) };
  const url = `${BASE}/${t.locale}/me/producer/${p.producerId}/requests`;
  const hw = claim.buildRequest.user;
  const address = [claim.buildRequest.addressLine, claim.buildRequest.city, claim.buildRequest.country].join(", ");
  const contact = (key: string, value: string | null) =>
    `${t.html(`notify.accepted.${key}`)}: <b>${escapeHtml(value ?? "—")}</b>`;

  await sendEmail({
    to: owner.email,
    subject: `[Poolwatt] ${t.text("notify.accepted.subject", vars)}`,
    html: t.layout(
      t.html("notify.hi", { name: owner.username }),
      t.html("notify.accepted.body", vars),
      `<b>${t.html("notify.accepted.contacts")}</b>`,
      [contact("name", hw.name), contact("email", hw.email), contact("phone", hw.phone), contact("address", address)].join("<br>\n"),
      t.html("notify.accepted.project", { source: claim.buildRequest.source, kw: claim.buildRequest.peakKw.toString() }),
      ...emailLink(url, t.html("notify.accepted.cta")),
    ),
  });
}
