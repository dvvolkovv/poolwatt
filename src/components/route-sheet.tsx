"use client";

// §27 «Маршрут через Google Maps, Apple Maps или Waze». Одна кнопка «отдать
// точку системе» остаётся первой: на Android чаще всего хотят именно её, и
// она же работает там, где ни одного из трёх приложений нет. Схему выбираем
// в момент нажатия, а не при отрисовке: на сервере угадать нечем.

import { useState } from "react";

export type RouteLabels = {
  route: string;
  openIn: string;
  system: string;
  google: string;
  apple: string;
  waze: string;
  cancel: string;
};

type Props = {
  lat: number;
  lng: number;
  name?: string;
  labels: RouteLabels;
  className?: string;
};

function systemUrl(lat: number, lng: number, name?: string): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const isiOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
  if (isiOS) {
    return `maps://?daddr=${lat},${lng}${name ? `&q=${encodeURIComponent(name)}` : ""}`;
  }
  if (/Android/.test(ua)) {
    return `geo:0,0?q=${lat},${lng}${name ? `(${encodeURIComponent(name)})` : ""}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function RouteSheet({ lat, lng, name, labels, className }: Props) {
  const [open, setOpen] = useState(false);

  function go(url: string) {
    setOpen(false);
    // location.href, а не window.open: иначе iOS заблокирует переход на
    // схему, которая не https.
    window.location.href = url;
  }

  const options = [
    { key: "system", label: labels.system, url: () => systemUrl(lat, lng, name) },
    {
      key: "google",
      label: labels.google,
      url: () => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    },
    {
      key: "apple",
      label: labels.apple,
      url: () => `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
    },
    {
      key: "waze",
      label: labels.waze,
      url: () => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="route-button"
        className={
          className ??
          "inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-accent-foreground"
        }
      >
        {labels.route}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60"
          onClick={() => setOpen(false)}
          data-testid="route-sheet"
        >
          <div
            className="w-full rounded-t-2xl border-t border-hairline bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-[12px] uppercase tracking-[0.16em] text-muted">
              {labels.openIn}
            </div>
            <ul className="divide-y divide-hairline">
              {options.map((o) => (
                <li key={o.key}>
                  <button
                    type="button"
                    onClick={() => go(o.url())}
                    data-testid={`route-${o.key}`}
                    className="w-full py-3 text-left text-[15px]"
                  >
                    {o.label}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-3 w-full rounded-lg border border-hairline py-3 text-[14px]"
            >
              {labels.cancel}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
