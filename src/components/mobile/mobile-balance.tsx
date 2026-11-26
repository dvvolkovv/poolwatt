"use client";

// US-17 "баланс обновляется в реальном времени по WebSocket", §22.2 — кВт·ч
// крупно, деньги под ним. Один компонент на главный экран и на кошелёк: на
// главном без разбивки, в кошельке с зонами и резервом.
//
// Он же пишет кэш для офлайн-страницы, и пишет его при каждом событии
// канала, а не только на серверном рендере: иначе телефон, который пролежал
// на экране кошелька час, уйдёт в офлайн с часовой цифрой.

import { useEffect, useState } from "react";
import { useChannel } from "@/hooks/use-channel";
import type { WalletRow } from "@/components/exchange/live-wallets";
import { BALANCE_CACHE_KEY, type CachedBalance } from "./balance-cache";

export type MobileBalanceLabels = {
  money: string;
  reserved: string;
  available: string;
  live: string;
  offline: string;
  empty: string;
};

export function MobileBalance({
  initial,
  channel,
  labels,
  detail = false,
}: {
  initial: WalletRow[];
  channel: string;
  labels: MobileBalanceLabels;
  detail?: boolean;
}) {
  const [wallets, setWallets] = useState(initial);
  // Покупка обновляет маршрут, и сервер присылает свежие балансы как
  // `initial` — US-07 требует, чтобы цифра двигалась сразу, с каналом или
  // без него.
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

  const totalKwh = wallets.reduce((sum, w) => sum + w.kwhBalance, 0);
  const primary = wallets.slice().sort((a, b) => b.kwhBalance - a.kwhBalance)[0] ?? null;
  const fiat = primary?.fiatBalance ?? 0;
  const currency = primary?.currency ?? "EUR";
  const zoneCode = primary?.zoneCode ?? null;

  useEffect(() => {
    try {
      const payload: CachedBalance = {
        kwh: totalKwh,
        fiat,
        currency,
        zoneCode,
        at: new Date().toISOString(),
      };
      window.localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Приватный режим, квота, старый WebView — цифра здесь удобство.
    }
  }, [totalKwh, fiat, currency, zoneCode]);

  return (
    <div className="mt-6">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
        <span
          aria-hidden
          className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${
            connected ? "bg-accent" : "bg-muted"
          }`}
        />
        <span data-testid="balance-live-state">
          {connected ? labels.live : labels.offline}
        </span>
      </div>

      <div
        data-testid="kwh-balance"
        className="num mt-1 text-[52px] font-semibold leading-none"
      >
        {totalKwh.toFixed(2)}
        <span className="ml-2 text-[18px] text-muted">kWh</span>
      </div>
      <div data-testid="fiat-balance" className="num mt-3 text-[16px] text-muted-strong">
        {fiat.toFixed(2)} {currency}
        <span className="ml-2 text-[13px] text-muted">{labels.money}</span>
      </div>

      {/* Ноль — настоящий баланс, поэтому крупная цифра есть всегда. Пусто
          бывает только в разбивке по зонам: кошелька в зоне ещё нет. */}
      {detail && wallets.length === 0 && (
        <p className="mt-5 text-[14px] text-muted" data-testid="no-wallet">
          {labels.empty}
        </p>
      )}

      {detail && wallets.length > 0 && (
        <ul className="mt-5 divide-y divide-hairline rounded-lg border border-hairline bg-card">
          {wallets.map((w) => (
            <li key={w.id} className="px-4 py-3" data-zone={w.zoneCode}>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-muted-strong">{w.zoneCode}</span>
                <span className="num text-[16px]" data-testid={`zone-kwh-${w.zoneCode}`}>
                  {w.kwhBalance.toFixed(3)} kWh
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between text-[12px] text-muted">
                <span>
                  {labels.available}{" "}
                  <span className="num">{w.availableFiat.toFixed(2)}</span> {w.currency}
                </span>
                <span>
                  {labels.reserved}{" "}
                  <span className="num">{w.reservedFiat.toFixed(2)}</span> {w.currency}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
