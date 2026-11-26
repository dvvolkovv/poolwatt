"use client";

// §25 — привязка этого телефона: отпечаток или лицо как подтверждение
// операций. Подпись проверяет сервер, поэтому кнопка сама ничего не решает:
// она только доносит ответ аутентификатора до него.

import { useEffect, useState } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";

export type DeviceLabels = {
  title: string;
  link: string;
  linking: string;
  linked: string;
  unsupported: string;
  none: string;
  forget: string;
  lastUsed: string;
  never: string;
  why: string;
};

type Device = { id: string; name: string | null; createdAt: string; lastUsedAt: string | null };

export function DeviceKeys({ labels }: { labels: DeviceLabels }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    // Всё состояние ставится из асинхронной ветки: синхронный setState в теле
    // эффекта заставляет React перерисовывать дерево дважды подряд.
    fetch("/api/v1/device-keys")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setSupported(browserSupportsWebAuthn());
        setDevices(data?.devices ?? []);
      })
      .catch(() => {
        setSupported(browserSupportsWebAuthn());
        setDevices([]);
      });
  }, []);

  async function link() {
    setBusy(true);
    setError(null);
    try {
      const challenge = await fetch("/api/v1/device-keys/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "register" }),
      });
      if (!challenge.ok) throw new Error((await challenge.json()).error ?? "Could not start");
      const { options } = await challenge.json();

      const response = await startRegistration(options);

      const verified = await fetch("/api/v1/device-keys/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response, name: deviceName() }),
      });
      if (!verified.ok) throw new Error((await verified.json()).error ?? "Could not verify");

      const list = await fetch("/api/v1/device-keys").then((r) => r.json());
      setDevices(list.devices ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link this device");
    } finally {
      setBusy(false);
    }
  }

  async function forget(id: string) {
    const res = await fetch(`/api/v1/device-keys/${id}`, { method: "DELETE" });
    if (res.ok) setDevices((cur) => (cur ?? []).filter((d) => d.id !== id));
  }

  return (
    <section className="mt-6" data-testid="device-keys">
      <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">{labels.title}</h2>

      {devices && devices.length > 0 ? (
        <ul className="mt-2 divide-y divide-hairline rounded-lg border border-hairline bg-card">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <span className="min-w-0">
                <span className="block truncate text-[14px]">{d.name ?? labels.title}</span>
                <span className="block text-[12px] text-muted">
                  {d.lastUsedAt
                    ? `${labels.lastUsed} ${new Date(d.lastUsedAt).toLocaleDateString()}`
                    : labels.never}
                </span>
              </span>
              <button
                type="button"
                onClick={() => forget(d.id)}
                data-testid="device-forget"
                className="rounded-full border border-hairline px-3 py-1.5 text-[12px] uppercase tracking-wider text-muted"
              >
                {labels.forget}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-muted">{labels.none}</p>
      )}

      {supported ? (
        <button
          type="button"
          onClick={link}
          disabled={busy}
          data-testid="device-link"
          className="mt-3 w-full rounded-full border border-hairline py-3 text-[13px] font-semibold uppercase tracking-[0.18em] disabled:opacity-50"
        >
          {busy ? labels.linking : labels.link}
        </button>
      ) : (
        <p className="mt-3 text-[13px] text-muted" data-testid="device-unsupported">
          {labels.unsupported}
        </p>
      )}

      {error && (
        <p className="mt-2 text-[13px] text-down" data-testid="device-error">
          {error}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-snug text-muted">{labels.why}</p>
    </section>
  );
}

/** Имя устройства — подсказка человеку, какой из телефонов это был. */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android";
  return "Browser";
}
