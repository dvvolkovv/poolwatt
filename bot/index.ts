import { setDefaultResultOrder } from "node:dns";
// Node 22+ defaults to "verbatim" DNS, which on hosts with broken IPv6 to
// api.telegram.org makes outbound requests hang for ~10s. Force IPv4 first.
setDefaultResultOrder("ipv4first");

import { Bot } from "grammy";
import { loadConfig } from "./config";
import { dispatch } from "./commands";

const config = loadConfig();
const bot = new Bot(config.telegramBotToken);

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from?.id ?? 0;
  const reply = (body: string, opts?: { parseMode?: "MarkdownV2" }) =>
    ctx.reply(body, opts?.parseMode ? { parse_mode: opts.parseMode } : undefined);

  if (text.startsWith("/whoami")) {
    await reply(`Your Telegram user id: \`${userId}\``, { parseMode: "MarkdownV2" });
    return;
  }

  if (text.startsWith("/")) {
    const handled = await dispatch(text, reply, {
      webBaseUrl: config.webBaseUrl,
      locale: "en",
    });
    if (!handled) {
      await reply(
        "Unknown command\\. Send /help to see what I can do\\.",
        { parseMode: "MarkdownV2" },
      );
    }
    return;
  }

  // Free-form text isn't routed to Claude in Poolwatt (unlike the reference
  // trientes bot). Nudge the user toward commands.
  await reply(
    "I respond to commands\\. Send /help to see them all\\.",
    { parseMode: "MarkdownV2" },
  );
});

bot.catch((err) => {
  // grammy's err.error is the underlying Error.
  console.error("[bot] error:", err.error);
});

void bot.start({
  onStart: (me) => {
    console.log(`[bot] @${me.username} is up. Allowed admin ids: ${config.adminUserIds.join(", ") || "(none)"}`);
  },
});
