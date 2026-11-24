import { sendEmail } from "@/lib/email";
import { emailLink, emailText, escapeHtml } from "@/lib/email-i18n";
import { prisma } from "@/lib/prisma";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export type InterestExpressedPayload = {
  claimId: string;
  buildRequestId: string;
  contractorName: string;
  ownerUserId: string;
};

export async function sendInterestExpressedToOwner(p: InterestExpressedPayload): Promise<void> {
  const owner = await prisma.user.findUnique({
    where: { id: p.ownerUserId },
    select: { email: true, emailVerified: true, username: true, preferredLocale: true },
  });
  if (!owner?.email || !owner.emailVerified) return;

  const t = await emailText(owner.preferredLocale);
  const url = `${BASE}/${t.locale}/me/build-requests/${p.buildRequestId}`;
  const vars = { id: p.buildRequestId.slice(0, 8), company: p.contractorName };

  await sendEmail({
    to: owner.email,
    subject: `[Poolwatt] ${t.text("notify.interest.subject", vars)}`,
    html: t.layout(
      t.html("notify.hi", { name: owner.username }),
      t.html("notify.interest.contractor", vars),
      ...emailLink(url, t.html("notify.interest.cta")),
    ),
  });
}

export type ClaimAcceptedPayload = {
  claimId: string;
  buildRequestId: string;
  contractorId: string;
};

export async function sendClaimAcceptedToContractor(p: ClaimAcceptedPayload): Promise<void> {
  const claim = await prisma.buildRequestClaim.findUnique({
    where: { id: p.claimId },
    select: {
      contractor: {
        select: {
          displayName: true,
          members: {
            where: { role: "OWNER" },
            take: 1,
            include: { user: { select: { email: true, emailVerified: true, username: true, preferredLocale: true } } },
          },
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
  const owner = claim.contractor.members[0]?.user;
  if (!owner?.email || !owner.emailVerified) return;

  const t = await emailText(owner.preferredLocale);
  const vars = { id: p.buildRequestId.slice(0, 8) };
  const url = `${BASE}/${t.locale}/me/contractor/${p.contractorId}/requests`;
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

export type ClaimRejectedPayload = {
  claimId: string;
  buildRequestId: string;
  contractorId: string;
};

export async function sendClaimRejectedToContractor(p: ClaimRejectedPayload): Promise<void> {
  const claim = await prisma.buildRequestClaim.findUnique({
    where: { id: p.claimId },
    select: {
      contractor: {
        select: {
          members: {
            where: { role: "OWNER" },
            take: 1,
            include: { user: { select: { email: true, emailVerified: true, username: true, preferredLocale: true } } },
          },
        },
      },
    },
  });
  if (!claim) return;
  const owner = claim.contractor.members[0]?.user;
  if (!owner?.email || !owner.emailVerified) return;

  const t = await emailText(owner.preferredLocale);
  const vars = { id: p.buildRequestId.slice(0, 8) };

  await sendEmail({
    to: owner.email,
    subject: `[Poolwatt] ${t.text("notify.rejected.subject", vars)}`,
    html: t.layout(
      t.html("notify.hi", { name: owner.username }),
      t.html("notify.rejected.body", vars),
      t.html("notify.rejected.more"),
    ),
  });
}
