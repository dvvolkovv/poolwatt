"use client";

// "Build a route" button. Picks the right scheme at click time (NOT render time
// — SSR would always guess wrong). iOS gets the maps:// scheme so Apple Maps
// opens the navigation card; Android gets the geo: intent so Google Maps /
// Yandex.Maps / any installed maps app can claim it; everyone else (desktop
// browsers, Windows phones if any survived) falls through to Google Maps web.

type Props = {
  lat: number;
  lng: number;
  name: string;
  label: string;
};

export function MapsDeepLink({ lat, lng, name, label }: Props) {
  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    const ua = navigator.userAgent;
    const isiOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
    const isAndroid = /Android/.test(ua);
    let url: string;
    if (isiOS) {
      url = `maps://?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`;
    } else if (isAndroid) {
      url = `geo:0,0?q=${lat},${lng}(${encodeURIComponent(name)})`;
    } else {
      url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    }
    // Use location.href so the OS gets the chance to claim the URL via its
    // app handler; window.open(_blank) would be blocked on iOS for non-https.
    window.location.href = url;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 bg-accent text-accent-foreground rounded-full px-5 py-3 font-semibold uppercase tracking-[0.18em] text-[13px] glow-accent transition-all hover:brightness-110"
    >
      <span aria-hidden>🧭</span>
      {label}
    </button>
  );
}
