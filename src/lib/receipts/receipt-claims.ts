// §46 — "Ошибочный чек или счёт бухгалтер возвращает в поддержку Poolwatt,
// исправление по регламенту с журналом изменений."
//
// This file is the first half: the accountant's claim and what support
// answers. The second half — issuing the corrected version — is
// `receipt-correction.ts`, because correcting a document is a different act
// from complaining about one, and the two have different rights.
//
// Who may file one: the network's owner, or an employee whose role carries
// `finance.read` (§47's ACCOUNTANT), and only for a receipt of a point they
// were given. A receipt of an exchange trade belongs to no network and has no
// accountant to return it.

import { type ReceiptClaimReason, type ReceiptClaimStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";
import { accountingAccess } from "@/lib/accounting/ledger";
import { sendEmail } from "@/lib/email";
import { operatorEmail } from "@/lib/operator-email";

export class ReceiptClaimError extends Error {}

/** The shortest complaint support can act on. */
const MIN_COMMENT = 10;

export interface ClaimInput {
  receiptId: string;
  reason: ReceiptClaimReason;
  comment: string;
}

export interface ClaimView {
  id: string;
  receiptId: string;
  receiptNumber: string | null;
  operatorId: string | null;
  operatorName: string | null;
  claimedBy: string;
  reason: ReceiptClaimReason;
  comment: string;
  status: ReceiptClaimStatus;
  resolution: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  /** The version issued in answer, when there is one. */
  issuedReceiptId: string | null;
  issuedReceiptNumber: string | null;
}

/** Which network a receipt belongs to, and at which point. */
export async function receiptNetwork(
  receiptId: string,
): Promise<{ operatorId: string | null; pointId: string | null } | null> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: {
      payment: { select: { pointId: true, point: { select: { operatorId: true } } } },
      reservation: { select: { pointId: true, point: { select: { operatorId: true } } } },
    },
  });
  if (!receipt) return null;
  const side = receipt.payment ?? receipt.reservation;
  return {
    operatorId: side?.point?.operatorId ?? null,
    pointId: side?.pointId ?? null,
  };
}

/**
 * File a claim. One claim at a time per receipt: the unique index on
 * (receipt, openKey) is what stops two accountants from opening two, rather
 * than a check both of their clicks could pass.
 */
export async function fileReceiptClaim(userId: string, input: ClaimInput) {
  const comment = input.comment.trim();
  if (comment.length < MIN_COMMENT) {
    throw new ReceiptClaimError("Say what is wrong with the document");
  }

  const where = await receiptNetwork(input.receiptId);
  if (!where) throw new ReceiptClaimError("No such receipt");
  if (!where.operatorId) {
    throw new ReceiptClaimError("This receipt belongs to no network, so support takes it directly");
  }

  const access = await accountingAccess(where.operatorId, userId);
  if (!access.allowed) throw new ReceiptClaimError("You do not keep this network's books");
  // §47 — an accountant given two points of fifty may only return those two.
  if (access.pointIds && where.pointId && !access.pointIds.includes(where.pointId)) {
    throw new ReceiptClaimError("That point is not in your scope");
  }

  let claim;
  try {
    claim = await prisma.receiptClaim.create({
      data: {
        receiptId: input.receiptId,
        operatorId: where.operatorId,
        claimedById: userId,
        reason: input.reason,
        comment,
        openKey: "open",
      },
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      throw new ReceiptClaimError("This receipt is already with support");
    }
    throw err;
  }

  await writeAudit(prisma, {
    actor: userId,
    entity: "ReceiptClaim",
    entityId: claim.id,
    action: "receipt.claim.filed",
    after: { receiptId: input.receiptId, reason: input.reason, operatorId: where.operatorId },
  });

  // Not awaited: the mail server is somebody else's and can be slow or
  // rate-limited, and the accountant's click should not wait on it. The claim
  // is in the queue either way, which is what support reads.
  void notifySupport(claim.id).catch((err) =>
    console.error("[receipts] claim mail failed", err),
  );

  return claim;
}

/** Support reads its own queue; nothing here is an accountant's business. */
export async function readClaimQueue(status?: ReceiptClaimStatus): Promise<ClaimView[]> {
  const rows = await prisma.receiptClaim.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: {
      receipt: { select: { number: true } },
      operator: { select: { displayName: true } },
      claimedBy: { select: { username: true } },
      corrections: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { issuedReceipt: { select: { id: true, number: true } } },
      },
    },
  });
  return rows.map(toView);
}

/** The claims of one network, for the accountant who filed them. */
export async function readClaimsForOperator(
  operatorId: string,
  userId: string,
): Promise<ClaimView[]> {
  const access = await accountingAccess(operatorId, userId);
  if (!access.allowed) throw new ReceiptClaimError("You do not keep this network's books");

  const rows = await prisma.receiptClaim.findMany({
    where: { operatorId },
    orderBy: { createdAt: "desc" },
    include: {
      receipt: { select: { number: true } },
      operator: { select: { displayName: true } },
      claimedBy: { select: { username: true } },
      corrections: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { issuedReceipt: { select: { id: true, number: true } } },
      },
    },
  });
  return rows.map(toView);
}

function toView(row: {
  id: string;
  receiptId: string;
  operatorId: string | null;
  reason: ReceiptClaimReason;
  comment: string;
  status: ReceiptClaimStatus;
  resolution: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  receipt: { number: string | null };
  operator: { displayName: string } | null;
  claimedBy: { username: string };
  corrections: { issuedReceipt: { id: string; number: string | null } }[];
}): ClaimView {
  const issued = row.corrections[0]?.issuedReceipt ?? null;
  return {
    id: row.id,
    receiptId: row.receiptId,
    receiptNumber: row.receipt.number,
    operatorId: row.operatorId,
    operatorName: row.operator?.displayName ?? null,
    claimedBy: row.claimedBy.username,
    reason: row.reason,
    comment: row.comment,
    status: row.status,
    resolution: row.resolution,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    issuedReceiptId: issued?.id ?? null,
    issuedReceiptNumber: issued?.number ?? null,
  };
}

/**
 * §46 — the claim goes "в поддержку Poolwatt", so somebody there has to be
 * told. The address is the one every operator notification uses.
 */
async function notifySupport(claimId: string): Promise<void> {
  const to = operatorEmail();
  if (!to) return;

  const claim = await prisma.receiptClaim.findUniqueOrThrow({
    where: { id: claimId },
    include: {
      receipt: { select: { number: true, id: true } },
      operator: { select: { displayName: true } },
      claimedBy: { select: { username: true } },
    },
  });

  const base = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";
  await sendEmail({
    to,
    subject: `Receipt ${claim.receipt.number ?? claim.receipt.id} returned by ${claim.operator?.displayName ?? "a network"}`,
    html: `
      <p><strong>${claim.claimedBy.username}</strong> returned a receipt to support.</p>
      <p>Document: ${claim.receipt.number ?? claim.receipt.id}<br>
      Network: ${claim.operator?.displayName ?? "—"}<br>
      Reason: ${claim.reason}</p>
      <blockquote>${escapeHtml(claim.comment)}</blockquote>
      <p><a href="${base}/en/admin/receipt-claims">Open the queue</a></p>
    `,
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Tell the accountant what support decided. Failing to send is not failing to decide. */
export async function notifyClaimant(claimId: string): Promise<void> {
  const claim = await prisma.receiptClaim.findUniqueOrThrow({
    where: { id: claimId },
    include: {
      receipt: { select: { number: true, id: true } },
      claimedBy: { select: { email: true, username: true } },
      corrections: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { issuedReceipt: { select: { id: true, number: true } } },
      },
    },
  });
  const to = claim.claimedBy.email;
  if (!to) return;

  const base = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";
  const issued = claim.corrections[0]?.issuedReceipt ?? null;
  await sendEmail({
    to,
    subject: `Receipt ${claim.receipt.number ?? claim.receipt.id}: ${claim.status === "CORRECTED" ? "corrected" : "answered"}`,
    html: `
      <p>Support has answered your claim about document
      ${claim.receipt.number ?? claim.receipt.id}.</p>
      <p>Decision: <strong>${claim.status}</strong></p>
      ${claim.resolution ? `<blockquote>${escapeHtml(claim.resolution)}</blockquote>` : ""}
      ${
        issued
          ? `<p>The document in force is now
             <a href="${base}/en/me/wallet/receipts/${issued.id}">${issued.number ?? issued.id}</a>.</p>`
          : ""
      }
    `,
  });
}
