"use client";

// US-17 — "видеть баланс кВт·ч и денег на главном экране", ТЗ §22.2: the kWh
// balance large, money under it, kept current over the §15 channel without a
// reload.

import { useState } from "react";
import { useChannel } from "@/hooks/use-channel";
import type { WalletRow } from "./live-wallets";

export type BalanceSummaryLabels = {
  kwhBalance: string;
  fiatBalance: string;
  available: string;
  live: string;
  offline: string;
  empty: string;
};

export function LiveBalanceSummary({
  initial,
  channel,
  labels,
}: {
  initial: WalletRow[];
  channel: string;
  labels: BalanceSummaryLabels;
}) {
  const [wallets, setWallets] = useState(initial);
  // The server re-renders this screen after a purchase; take its figures.
  const [seeded, setSeeded] = useState(initial);
  if (seeded !== initial) {
    setSeeded(initial);
    setWallets(initial);
  }

  const { connected } = useChannel(channel, (event) => {
    if (event.type !== "wallet.updated") return;
    const next = event.data.wallets;
    if (Array.isArray(next)) setWallets(next as WalletRow[]);
  });

  if (wallets.length === 0) {
    return <p className="text-sm text-muted">{labels.empty}</p>;
  }

  return (
    <div>
      <div className="mb-3 text-[11px] uppercase tracking-[0.14em] text-muted">
        <span
          aria-hidden
          className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${
            connected ? "bg-accent" : "bg-muted"
          }`}
        />
        <span data-testid="home-live-state">{connected ? labels.live : labels.offline}</span>
      </div>

      <div className="space-y-6">
        {wallets.map((w) => (
          <section key={w.id} data-testid={`home-wallet-${w.zoneCode}`}>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
              {w.zoneCode} · {labels.kwhBalance}
            </div>
            <div className="num text-[34px] sm:text-[44px] leading-none font-semibold tracking-[-0.02em]">
              <span data-testid={`home-kwh-${w.zoneCode}`}>{w.kwhBalance.toFixed(3)}</span>
              <span className="ml-2 text-[16px] text-muted">kWh</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
              <span className="text-muted">
                {labels.fiatBalance}{" "}
                <b className="num text-foreground" data-testid={`home-fiat-${w.zoneCode}`}>
                  {w.fiatBalance.toFixed(2)} {w.currency}
                </b>
              </span>
              <span className="text-muted">
                {labels.available}{" "}
                <b className="num text-foreground">
                  {w.availableFiat.toFixed(2)} {w.currency}
                </b>
              </span>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
