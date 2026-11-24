"use client";

// US-17 — "видеть баланс кВт·ч и денег на главном экране", updating by
// itself. The server renders the balances; this keeps them current while the
// page stays open, so a charge started on the phone shows up here without a
// reload.

import { useState } from "react";
import Link from "next/link";
import { useChannel } from "@/hooks/use-channel";

export type WalletRow = {
  id: string;
  zoneId: string;
  zoneCode: string;
  currency: string;
  kwhBalance: number;
  fiatBalance: number;
  reservedFiat: number;
  availableFiat: number;
};

export type LiveWalletsLabels = {
  zone: string;
  kwhBalance: string;
  fiatBalance: string;
  reserved: string;
  available: string;
  live: string;
  offline: string;
};

export function LiveWallets({
  initial,
  channel,
  locale,
  labels,
}: {
  initial: WalletRow[];
  channel: string;
  locale: string;
  labels: LiveWalletsLabels;
}) {
  const [wallets, setWallets] = useState(initial);
  // A purchase refreshes the route, and the server sends fresh balances down
  // as `initial`. Without this the figures would sit at whatever they were on
  // first render whenever the channel is down — and US-07 wants the kWh
  // balance to move straight away, socket or no socket.
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

  return (
    <div className="mb-10">
      <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-muted">
        <span
          aria-hidden
          className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${
            connected ? "bg-accent" : "bg-muted"
          }`}
        />
        <span data-testid="wallet-live-state">{connected ? labels.live : labels.offline}</span>
      </div>

      <div className="space-y-4">
        {wallets.map((w) => (
          <section key={w.id} className="rounded border border-hairline p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-[12px] uppercase tracking-[0.14em] text-muted">
                {labels.zone} {w.zoneCode}
              </span>
              <Link
                href={`/${locale}/exchange?zone=${w.zoneCode}`}
                prefetch={false}
                className="text-[12px] text-muted underline hover:text-foreground"
              >
                {w.currency}
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Figure
                label={labels.kwhBalance}
                value={w.kwhBalance.toFixed(3)}
                unit="kWh"
                testId={`wallet-kwh-${w.zoneCode}`}
                big
              />
              <Figure label={labels.fiatBalance} value={w.fiatBalance.toFixed(2)} unit={w.currency} />
              <Figure label={labels.reserved} value={w.reservedFiat.toFixed(2)} unit={w.currency} />
              <Figure
                label={labels.available}
                value={w.availableFiat.toFixed(2)}
                unit={w.currency}
                testId={`wallet-available-${w.zoneCode}`}
              />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  unit,
  big,
  testId,
}: {
  label: string;
  value: string;
  unit?: string;
  big?: boolean;
  testId?: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={`num ${big ? "text-[24px] font-semibold" : "text-[16px]"}`}>
        <span data-testid={testId}>{value}</span>
        {unit && <span className="ml-1 text-[12px] text-muted">{unit}</span>}
      </div>
    </div>
  );
}
