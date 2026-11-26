"use client";

// §22.9, US-20 «ход зарядки». Крупная цифра выданных кВт·ч, под ней мощность,
// время и стоимость по текущему водопаду.
//
// Цифра двигается событиями канала `wallet.{user}` — того же, что держит
// баланс (§15). Отдельный канал ради тех же данных означал бы второй билет.

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChannel, type ChannelEvent } from "@/hooks/use-channel";
import { stopCharge } from "@/app/[locale]/app/charge/actions";

export type LiveSession = {
  id: string;
  status: string;
  pointId: string;
  pointName: string;
  pointAddress: string;
  connectorType: string;
  connectorPowerKw: number;
  plannedKwh: number;
  deliveredKwh: number;
  currency: string;
  startedAt: string | null;
  paymentId: string | null;
};

export type ChargeLiveLabels = {
  live: string;
  delivered: string;
  power: string;
  elapsed: string;
  cost: string;
  waiting: string;
  stop: string;
  stopHint: string;
  report: string;
  done: string;
};

function elapsed(from: string | null, now: number): string {
  if (!from) return "—";
  const seconds = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function ChargeLive({
  locale,
  initial,
  initialPowerKw,
  pricePerKwh,
  channel,
  labels,
}: {
  locale: string;
  initial: LiveSession;
  initialPowerKw: number | null;
  /** Цена кВт·ч этого сеанса из согласованного расчёта — для «стоимости». */
  pricePerKwh: number;
  channel: string;
  labels: ChargeLiveLabels;
}) {
  const router = useRouter();
  const [session, setSession] = useState(initial);
  const [powerKw, setPowerKw] = useState(initialPowerKw);
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useChannel(channel, (event: ChannelEvent) => {
    if (event.type !== "charge.tick" && event.type !== "charge.completed") return;
    const next = event.data.session as LiveSession | undefined;
    if (!next || next.id !== session.id) return;
    setSession(next);
    if (typeof event.data.powerKw === "number") setPowerKw(event.data.powerKw);
    // Сеанс закончился не нами — на экране должен появиться чек.
    if (event.type === "charge.completed") router.refresh();
  });

  function finish() {
    startTransition(async () => {
      await stopCharge(session.id);
      router.refresh();
    });
  }

  return (
    <div data-testid="charge-live">
      <section className="mt-2">
        <div className="text-[12px] uppercase tracking-[0.16em] text-muted">
          {labels.live}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="num text-[44px] leading-none" data-testid="charge-delivered">
            {session.deliveredKwh.toFixed(3)}
          </span>
          <span className="text-[16px] text-muted">kWh</span>
        </div>
        {session.deliveredKwh === 0 && (
          <p className="mt-2 text-[13px] text-muted" data-testid="charge-waiting">
            {labels.waiting}
          </p>
        )}
      </section>

      <section className="mt-6 grid grid-cols-3 gap-2">
        <Tile label={labels.power} value={powerKw == null ? "—" : `${powerKw} kW`} />
        <Tile label={labels.elapsed} value={elapsed(session.startedAt, now)} />
        <Tile
          label={labels.cost}
          value={`${(session.deliveredKwh * pricePerKwh).toFixed(2)} ${session.currency}`}
        />
      </section>

      <section className="mt-6 rounded-lg border border-hairline bg-card px-4 py-3">
        <div className="text-[15px]">{session.pointName}</div>
        {session.pointAddress && (
          <div className="text-[13px] text-muted">{session.pointAddress}</div>
        )}
        <div className="mt-2 text-[13px] text-muted">
          {session.connectorType} · <span className="num">{session.connectorPowerKw}</span> kW
        </div>
      </section>

      <button
        type="button"
        onClick={finish}
        disabled={pending}
        data-testid="charge-stop"
        className="mt-6 w-full rounded-lg border border-hairline px-4 py-4 text-[16px] disabled:opacity-60"
      >
        {labels.stop}
      </button>
      {/* Мост OCPP закрыт: кнопка рассчитывает сеанс, а кабель водитель
          отсоединяет сам. Честнее сказать это, чем изобразить команду. */}
      <p className="mt-2 text-[12px] text-muted">{labels.stopHint}</p>

      <Link
        href={`/${locale}/c/${session.pointId}/report`}
        className="mt-6 block text-center text-[14px] text-muted underline"
        data-testid="charge-report"
      >
        {labels.report}
      </Link>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-card px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="num mt-1 text-[15px]">{value}</div>
    </div>
  );
}
