// GET /v1/receipts/{id} — ТЗ §15, §46.
import { forbidden, notFound, ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { num } from "@/lib/exchange/decimal";
import { readReceipt } from "@/lib/exchange/payment-service";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const receipt = await readReceipt(id);
  if (!receipt) return notFound("Receipt not found");

  // A receipt belongs to the wallet owner on either leg of the transaction.
  const walletIds = await prisma.wallet.findMany({
    where: { ownerUserId: user.id },
    select: { id: true },
  });
  const mine = new Set(walletIds.map((w) => w.id));
  let owned = receipt.payment ? mine.has(receipt.payment.walletId) : false;
  if (!owned && receipt.trade) {
    const trade = await prisma.trade.findUnique({
      where: { id: receipt.trade.id },
      select: { buyOrder: { select: { walletId: true } }, sellOrder: { select: { walletId: true } } },
    });
    owned = Boolean(
      trade && (mine.has(trade.buyOrder.walletId) || mine.has(trade.sellOrder.walletId)),
    );
  }
  if (!owned && user.role !== "ADMIN") return forbidden();

  return ok({
    receipt: {
      id: receipt.id,
      paymentId: receipt.paymentId,
      tradeId: receipt.tradeId,
      burnedTokenIds: receipt.burnedTokenIds,
      totalKwh: num(receipt.totalKwh),
      totalFiat: num(receipt.totalFiat),
      currency: receipt.currency,
      breakdown: receipt.breakdown,
      issuedAt: receipt.issuedAt.toISOString(),
    },
  });
}
