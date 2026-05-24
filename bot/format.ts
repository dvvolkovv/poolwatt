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
    `${city} · *${price}* USD/кВт·ч · ${avail} кВт·ч свободно · заряд ${soc}`,
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
    `· Источник: *${escapeMd(p.primarySource.toLowerCase())}*`,
    `· Ёмкость: *${escapeMd(`${p.capacityKwh.toFixed(1)} кВт·ч`)}*`,
    `· Инвертор: *${escapeMd(`${p.inverterKw.toFixed(1)} кВт`)}*`,
    `· Заряд: *${escapeMd(`${p.stateOfChargePct}%`)}*`,
    `· Доступно сейчас: *${escapeMd(`${p.availableKwh.toFixed(2)} кВт·ч`)}*`,
    `· Цена: *${escapeMd(`${p.pricePerKwhUsd.toFixed(3)} USD/кВт·ч`)}*`,
    `· Отдано за 24ч: *${escapeMd(`${p.delivered24hKwh.toFixed(1)} кВт·ч`)}*`,
    `· Всего за всё время: *${escapeMd(`${p.deliveredLifetimeKwh.toLocaleString()} кВт·ч`)}*`,
    `· Аптайм: *${escapeMd(`${p.uptimePct.toFixed(1)}%`)}*`,
    `· CO₂\\-офсет за 24ч: *${escapeMd(`${p.carbonOffsetKgCo2e.toFixed(1)} кг`)}*`,
    "",
    escapeMd(`Открыть в браузере: ${webBaseUrl}/${locale}/p/${p.handle}`),
  ];
  return lines.join("\n");
}

export function renderGridStats(g: GridSnap, gi: GreenIndex | null): string {
  return [
    "*Сеть Poolwatt — live*",
    "",
    `· Ёмкость: *${escapeMd(`${g.totalCapacityKwh.toLocaleString()} кВт·ч`)}*`,
    `· Отдано за 24ч: *${escapeMd(`${g.totalDelivered24hKwh.toLocaleString()} кВт·ч`)}*`,
    `· Всего за всё время: *${escapeMd(`${g.totalLifetimeKwh.toLocaleString()} кВт·ч`)}*`,
    `· Активных производителей: *${escapeMd(g.activeProducers.toString())}*`,
    `· Активных хабов: *${escapeMd(g.activeHubs.toString())}*`,
    `· Микс: ☀️ ${escapeMd(`${g.solarSharePct.toFixed(1)}%`)} · 💨 ${escapeMd(`${g.windSharePct.toFixed(1)}%`)} · 💧 ${escapeMd(`${g.hydroSharePct.toFixed(1)}%`)} · ⚡️ ${escapeMd(`${g.otherSharePct.toFixed(1)}%`)}`,
    `· CO₂\\-офсет за 24ч: *${escapeMd(`${g.carbonOffset24hKgCo2e.toLocaleString()} кг`)}*`,
    gi ? `· Green Index: *${escapeMd(`${gi.value} (${gi.classification})`)}*` : "",
  ].filter(Boolean).join("\n");
}
