import { MOCK_PRODUCERS } from "../src/lib/producers";
import { readGridStats, readGreenIndex } from "../src/lib/snapshot";
import {
  renderProducerShort,
  renderProducerDetail,
  renderGridStats,
  escapeMd,
} from "./format";

export type Reply = (text: string, opts?: { parseMode?: "MarkdownV2" }) => Promise<unknown>;

export type CommandDeps = {
  webBaseUrl: string;
  /** caller's preferred locale — used to build deep links inside messages */
  locale: string;
};

type CommandHandler = (args: string[], reply: Reply, deps: CommandDeps) => Promise<void>;

const HELP_TEXT = [
  "*Poolwatt* — P2P renewable energy marketplace",
  "",
  "Available commands:",
  "· /start — welcome",
  "· /help — this message",
  "· /producers — top 10 producers right now",
  "· /producer `<handle>` — full profile for one producer",
  "· /grid — network-wide live stats",
  "· /greenindex — current Green Index reading",
  "· /watch `<handle>` — add producer to your watchlist",
  "· /unwatch `<handle>` — remove from watchlist",
  "· /buy `<handle>` `<kwh>` — open an offer-to-buy",
  "· /listing — apply to list your household on Poolwatt",
  "· /whoami — show your Telegram user id",
].join("\n");

export const handlers: Record<string, CommandHandler> = {
  "/start": async (_args, reply, _deps) => {
    await reply(
      [
        "*Welcome to Poolwatt*",
        "",
        "Poolwatt is a peer\\-to\\-peer marketplace where households sell battery\\-stored renewable electricity\\.",
        "",
        "Send /help to see what I can do\\.",
      ].join("\n"),
      { parseMode: "MarkdownV2" },
    );
  },

  "/help": async (_args, reply) => {
    await reply(HELP_TEXT, { parseMode: "MarkdownV2" });
  },

  "/producers": async (_args, reply) => {
    const top = MOCK_PRODUCERS.slice(0, 10);
    const body = top
      .map((p, i) => `*${i + 1}\\.* ${renderProducerShort(p)}`)
      .join("\n\n");
    await reply(`*Top producers on Poolwatt*\n\n${body}`, { parseMode: "MarkdownV2" });
  },

  "/producer": async (args, reply, deps) => {
    const handle = (args[0] ?? "").replace(/^@/, "").trim();
    if (!handle) {
      await reply("Usage: /producer `<handle>`", { parseMode: "MarkdownV2" });
      return;
    }
    const p = MOCK_PRODUCERS.find((x) => x.handle === handle);
    if (!p) {
      await reply(`No producer with handle \`${escapeMd(handle)}\` found\\.`, {
        parseMode: "MarkdownV2",
      });
      return;
    }
    await reply(renderProducerDetail(p, deps.webBaseUrl, deps.locale), {
      parseMode: "MarkdownV2",
    });
  },

  "/grid": async (_args, reply) => {
    const [stats, gi] = await Promise.all([readGridStats(), readGreenIndex()]);
    if (!stats) {
      await reply("Grid telemetry unavailable\\.", { parseMode: "MarkdownV2" });
      return;
    }
    await reply(renderGridStats(stats, gi), { parseMode: "MarkdownV2" });
  },

  "/greenindex": async (_args, reply) => {
    const gi = await readGreenIndex();
    if (!gi) {
      await reply("Green Index unavailable\\.", { parseMode: "MarkdownV2" });
      return;
    }
    await reply(
      `*Green Index*: *${escapeMd(gi.value.toString())}* — _${escapeMd(gi.classification)}_`,
      { parseMode: "MarkdownV2" },
    );
  },

  "/watch": async (args, reply) => {
    const handle = (args[0] ?? "").replace(/^@/, "").trim();
    if (!handle) {
      await reply("Usage: /watch `<handle>`", { parseMode: "MarkdownV2" });
      return;
    }
    // Phase 2: persist via Prisma. For now ack.
    await reply(`Added \`${escapeMd(handle)}\` to your watchlist\\.`, {
      parseMode: "MarkdownV2",
    });
  },

  "/unwatch": async (args, reply) => {
    const handle = (args[0] ?? "").replace(/^@/, "").trim();
    if (!handle) {
      await reply("Usage: /unwatch `<handle>`", { parseMode: "MarkdownV2" });
      return;
    }
    await reply(`Removed \`${escapeMd(handle)}\` from your watchlist\\.`, {
      parseMode: "MarkdownV2",
    });
  },

  "/buy": async (args, reply) => {
    const handle = (args[0] ?? "").replace(/^@/, "").trim();
    const kwh = Number(args[1]);
    if (!handle || !Number.isFinite(kwh) || kwh <= 0) {
      await reply("Usage: /buy `<handle>` `<kwh>`", { parseMode: "MarkdownV2" });
      return;
    }
    const p = MOCK_PRODUCERS.find((x) => x.handle === handle);
    if (!p) {
      await reply(`No producer with handle \`${escapeMd(handle)}\` found\\.`, {
        parseMode: "MarkdownV2",
      });
      return;
    }
    if (kwh > p.availableKwh) {
      await reply(
        `Only ${escapeMd(p.availableKwh.toFixed(2))} kWh currently available from \`${escapeMd(handle)}\`\\.`,
        { parseMode: "MarkdownV2" },
      );
      return;
    }
    const totalUsd = (kwh * p.pricePerKwhUsd).toFixed(2);
    await reply(
      [
        "*Offer to buy* — preview only",
        "",
        `· Producer: ${escapeMd(p.displayName)} \\(\`${escapeMd(p.handle)}\`\\)`,
        `· Volume: *${escapeMd(kwh.toFixed(2))} kWh*`,
        `· Unit price: *${escapeMd(p.pricePerKwhUsd.toFixed(3))} USD/kWh*`,
        `· Total: *${escapeMd(totalUsd)} USD*`,
        "",
        "Confirm via the web portal — wallet signing will appear here in Phase 3\\.",
      ].join("\n"),
      { parseMode: "MarkdownV2" },
    );
  },

  "/listing": async (_args, reply, deps) => {
    await reply(
      [
        "*List your household on Poolwatt*",
        "",
        "1\\. Make sure your powerbank is charged from a renewable source \\(solar/wind/hydro/biomass\\)\\.",
        "2\\. Get your inverter make + capacity ready\\.",
        "3\\. Submit at:",
        escapeMd(`${deps.webBaseUrl}/${deps.locale}/request`),
      ].join("\n"),
      { parseMode: "MarkdownV2" },
    );
  },

  "/whoami": async (_args, reply, _deps) => {
    // The bot index injects userId into the deps wrapper if it wants to expose
    // it here; we leave this as a no-op so the dispatcher can still mention
    // the command in /help without crashing.
    await reply("Your Telegram user id is shown via the bot dispatcher\\.", {
      parseMode: "MarkdownV2",
    });
  },
};

export async function dispatch(
  text: string,
  reply: Reply,
  deps: CommandDeps,
): Promise<boolean> {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const handler = handlers[cmd];
  if (!handler) return false;
  await handler(parts.slice(1), reply, deps);
  return true;
}
