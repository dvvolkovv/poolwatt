// Everything the mobile shell needs to draw itself, in one round-trip: the
// §20 badge, the two capability flags the hub reads, and the balances the
// main screen shows big (§22.2).

import { CoopMemberStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roundKwh } from "@/lib/exchange/precision";
import { readUserStatus, type UserStatus } from "@/lib/exchange/user-status";
import { readWallets, type WalletView } from "@/lib/exchange/wallet-service";

export interface ShellContext {
  /** Always true: the context is only read for a signed-in account. */
  signedIn: boolean;
  status: UserStatus;
  hasAsset: boolean;
  isCoopMember: boolean;
  wallets: WalletView[];
  /** Every zone added up: the figure §22.2 shows big. */
  totalKwh: number;
  /** The wallet with the most kWh — whose zone and currency the screen names. */
  primary: WalletView | null;
}

export async function readShellContext(userId: string): Promise<ShellContext> {
  const [status, asset, member, wallets] = await Promise.all([
    readUserStatus(userId),
    prisma.asset.findFirst({
      where: { company: { ownerUserId: userId } },
      select: { id: true },
    }),
    prisma.coopMember.findFirst({
      where: { userId, status: CoopMemberStatus.ACTIVE, shares: { gt: 0 } },
      select: { id: true },
    }),
    readWallets(userId),
  ]);

  const totalKwh = roundKwh(wallets.reduce((sum, w) => sum + w.kwhBalance, 0));
  const primary =
    wallets.slice().sort((a, b) => b.kwhBalance - a.kwhBalance)[0] ?? null;

  return {
    signedIn: true,
    status,
    hasAsset: Boolean(asset),
    isCoopMember: Boolean(member),
    wallets,
    totalKwh,
    primary,
  };
}
