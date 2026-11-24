// GET /v1/wallets/me — ТЗ §15, §7, US-17.
import { ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { readWallets } from "@/lib/exchange/wallet-service";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { publishableIban } from "@/lib/exchange/gates";
import { roundPrice } from "@/lib/exchange/precision";

export async function GET() {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const wallets = await readWallets(user.id);

  // §7 "средняя цена покупки" — volume-weighted across the user's buy fills.
  const buys = await prisma.trade.findMany({
    where: { buyOrder: { wallet: { ownerUserId: user.id } } },
    select: { amountKwh: true, price: true },
  });
  const boughtKwh = buys.reduce((sum, t) => sum + num(t.amountKwh), 0);
  const boughtValue = buys.reduce((sum, t) => sum + num(t.amountKwh) * num(t.price), 0);

  const account = await prisma.settlementAccount.findUnique({
    where: { userId: user.id },
    select: { id: true, iban: true, currency: true, balance: true, status: true },
  });

  return ok({
    wallets,
    averagePurchasePrice: boughtKwh > 0 ? roundPrice(boughtValue / boughtKwh) : null,
    lifetimeBoughtKwh: Math.round(boughtKwh * 1000) / 1000,
    account: account
      ? { ...account, iban: publishableIban(account.iban), balance: num(account.balance) }
      : null,
  });
}
