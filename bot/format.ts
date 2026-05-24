import type { ProducerRow, GridSnap } from "../src/lib/producers";
import type { GreenIndex } from "../src/lib/green-index";

const SOURCE_GLYPH: Record<string, string> = {
  SOLAR: "☀️",
  WIND: "💨",
  HYDRO: "💧",
  BIOMASS: "🌿",
  GEOTHERMAL: "🌋",
  HYBRID: "⚡️",
};

export function escapeMd(s: string): string {
  // Telegram MarkdownV2 reserves these characters; escape every one.
  return s.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, (m) => `\\${m}`);
}

export function renderProducerShort(p: ProducerRow): string {
  const src = SOURCE_GLYPH[p.primarySource] ?? "⚡️";
  const handle = escapeMd(p.handle);
  const name = escapeMd(p.displayName);
  const city = escapeMd(`${p.city}, ${p.country}`);
  const price = escapeMd(p.pricePerKwhUsd.toFixed(3));
  const avail = escapeMd(p.availableKwh.toFixed(1));
  const soc = escapeMd(`${p.stateOfChargePct}%`);
  return [
    `${src} *${name}* \\(\`${handle}\`\\)`,
    `${city} · *${price}* USD/kWh · ${avail} kWh free · charge ${soc}`,
  ].join("\n");
}

export function renderProducerDetail(p: ProducerRow, webBaseUrl: string, locale: string): string {
  const src = SOURCE_GLYPH[p.primarySource] ?? "⚡️";
  const handle = escapeMd(p.handle);
  const name = escapeMd(p.displayName);
  const city = escapeMd(`${p.city}, ${p.country}`);
  const lines = [
    `${src} *${name}*`,
    `_${city}_`,
    "",
    `· Source: *${escapeMd(p.primarySource.toLowerCase())}*`,
    `· Capacity: *${escapeMd(`${p.capacityKwh.toFixed(1)} kWh`)}*`,
    `· Inverter: *${escapeMd(`${p.inverterKw.toFixed(1)} kW`)}*`,
    `· State of charge: *${escapeMd(`${p.stateOfChargePct}%`)}*`,
    `· Available now: *${escapeMd(`${p.availableKwh.toFixed(2)} kWh`)}*`,
    `· Price: *${escapeMd(`${p.pricePerKwhUsd.toFixed(3)} USD/kWh`)}*`,
    `· Delivered 24h: *${escapeMd(`${p.delivered24hKwh.toFixed(1)} kWh`)}*`,
    `· Lifetime: *${escapeMd(`${p.deliveredLifetimeKwh.toLocaleString()} kWh`)}*`,
    `· Uptime: *${escapeMd(`${p.uptimePct.toFixed(1)}%`)}*`,
    `· CO₂ offset 24h: *${escapeMd(`${p.carbonOffsetKgCo2e.toFixed(1)} kg`)}*`,
    "",
    escapeMd(`Open in browser: ${webBaseUrl}/${locale}/p/${p.handle}`),
  ];
  return lines.join("\n");
}

export function renderGridStats(g: GridSnap, gi: GreenIndex | null): string {
  return [
    "*Poolwatt Grid — live*",
    "",
    `· Capacity: *${escapeMd(`${g.totalCapacityKwh.toLocaleString()} kWh`)}*`,
    `· Delivered 24h: *${escapeMd(`${g.totalDelivered24hKwh.toLocaleString()} kWh`)}*`,
    `· Lifetime: *${escapeMd(`${g.totalLifetimeKwh.toLocaleString()} kWh`)}*`,
    `· Active producers: *${escapeMd(g.activeProducers.toString())}*`,
    `· Active hubs: *${escapeMd(g.activeHubs.toString())}*`,
    `· Mix: ☀️ ${escapeMd(`${g.solarSharePct.toFixed(1)}%`)} · 💨 ${escapeMd(`${g.windSharePct.toFixed(1)}%`)} · 💧 ${escapeMd(`${g.hydroSharePct.toFixed(1)}%`)} · ⚡️ ${escapeMd(`${g.otherSharePct.toFixed(1)}%`)}`,
    `· CO₂ offset 24h: *${escapeMd(`${g.carbonOffset24hKgCo2e.toLocaleString()} kg`)}*`,
    gi ? `· Green Index: *${escapeMd(`${gi.value} (${gi.classification})`)}*` : "",
  ].filter(Boolean).join("\n");
}
