// What the QR code leads to — ТЗ §46 item 8.
//
// A printed receipt ends up on a counter, in a glovebox, in a bin. The page
// behind its QR code is therefore open to anyone holding the paper, and that
// decides what it may say: enough to tell a forgery from a real document, and
// nothing about the person who charged. No user, no wallet, no token list.

import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";

export interface ReceiptProof {
  number: string | null;
  issuedAt: Date;
  kind: string;
  totalKwh: number;
  totalFiat: number;
  currency: string;
  pointName: string | null;
  networkName: string | null;
}

export async function verifyReceipt(code: string): Promise<ReceiptProof | null> {
  if (!/^[0-9a-f]{32}$/.test(code)) return null;

  const receipt = await prisma.receipt.findUnique({
    where: { verifyCode: code },
    select: {
      number: true,
      issuedAt: true,
      totalKwh: true,
      totalFiat: true,
      currency: true,
      breakdown: true,
      paymentId: true,
      tradeId: true,
      reservationId: true,
      payment: { select: { point: { select: { name: true, operator: { select: { displayName: true } } } } } },
      reservation: { select: { point: { select: { name: true, operator: { select: { displayName: true } } } } } },
    },
  });
  if (!receipt) return null;

  const point = receipt.payment?.point ?? receipt.reservation?.point ?? null;
  const b = (receipt.breakdown ?? {}) as Record<string, unknown>;
  const kind =
    typeof b.kind === "string"
      ? b.kind
      : receipt.paymentId
        ? "charge"
        : receipt.tradeId
          ? "trade"
          : receipt.reservationId
            ? "reservation.no_show"
            : "other";

  return {
    number: receipt.number,
    issuedAt: receipt.issuedAt,
    kind,
    totalKwh: num(receipt.totalKwh),
    totalFiat: num(receipt.totalFiat),
    currency: receipt.currency,
    pointName: point?.name ?? null,
    networkName: point?.operator.displayName ?? null,
  };
}
