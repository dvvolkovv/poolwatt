import { setDefaultResultOrder } from "node:dns";
// Node 22+ defaults to "verbatim" DNS, which on hosts with broken IPv6 to
// api.telegram.org makes outbound requests hang for ~10s. Force IPv4 first.
setDefaultResultOrder("ipv4first");

import { Bot, type Context } from "grammy";
import { loadConfig } from "./config";
import { dispatch } from "./commands";
import { isAllowed } from "./auth";
import { SessionStore } from "./session";
import { ClaudeRunner } from "./claudeRunner";
import { StatusUpdater, truncate } from "./telegramView";
import { renderToolStatus } from "./statusRender";

const config = loadConfig();
const bot = new Bot(config.telegramBotToken);
const session = new SessionStore();
const runner = new ClaudeRunner({
  cwd: config.claudeCwd,
  timeoutMs: config.claudeTimeoutMs,
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from?.id ?? 0;
  const authorized = isAllowed(userId, config.allowedUserIds);
  const reply = (body: string, opts?: { parseMode?: "MarkdownV2" }) =>
    ctx.reply(body, opts?.parseMode ? { parse_mode: opts.parseMode } : undefined);

  if (text.startsWith("/")) {
    const handled = await dispatch(text, reply, {
      webBaseUrl: config.webBaseUrl,
      locale: "en",
      userId,
      isAuthorized: authorized,
      session,
      runner,
    });
    if (!handled) {
      await reply(
        "Unknown command\\. Send /help to see what I can do\\.",
        { parseMode: "MarkdownV2" },
      );
    }
    return;
  }

  // Free-form text — route to Claude for whitelisted users only.
  if (!authorized) {
    await reply(
      "I respond to commands\\. Send /help to see them all\\.",
      { parseMode: "MarkdownV2" },
    );
    return;
  }

  await processPrompt(ctx, userId, text);
});

async function processPrompt(
  ctx: Context,
  userId: number,
  prompt: string,
): Promise<void> {
  if (runner.isActive(userId)) {
    await ctx.reply("Текущая задача ещё идёт — /cancel или подожди.");
    return;
  }

  const placeholder = await ctx.reply("🤔 думаю…");
  const status = new StatusUpdater(bot, ctx.chat!.id, placeholder.message_id);
  const verbose = session.getVerbose(userId);
  const existing = session.get(userId);
  let writtenSessionId: string | null = existing?.claudeSessionId ?? null;

  try {
    const result = await runner.run({
      userId,
      prompt,
      sessionId: existing?.claudeSessionId ?? null,
      onEvent: (ev) => {
        if (ev.kind === "init" && !writtenSessionId) {
          writtenSessionId = ev.sessionId;
          session.set(userId, ev.sessionId);
        }
        if (ev.kind === "tool_use") {
          const line = renderToolStatus(ev.toolName, ev.input);
          if (verbose) {
            void ctx.reply(line);
          } else {
            status.update(line);
          }
        }
      },
    });

    await status.flush();

    if (writtenSessionId) {
      session.touch(userId);
    }

    const partial = (result.finalText || "").trim();
    let body: string;

    if (result.exitCode === 0) {
      body = truncate(partial || "(пусто)", 3500) + "\n\n✅ готово";
    } else if (result.canceled) {
      body =
        "⏹ Остановил по твоей команде." +
        (partial ? "\n\nЧто успел сделать:\n" + truncate(partial, 3000) : "");
    } else if (result.timedOut) {
      const mins = Math.round(config.claudeTimeoutMs / 60000);
      body =
        `⏳ Задача шла дольше ${mins} мин — остановил по таймауту.` +
        (partial ? "\n\nЧто успел к этому моменту:\n" + truncate(partial, 3000) : "") +
        "\n\nНапиши «продолжи» — доделаю с того же места.";
    } else {
      body =
        `⚠️ Сессия завершилась нештатно (код ${result.exitCode}). Хвост лога:\n` +
        "```\n" +
        truncate(result.stderrTail || "(пусто)", 1500) +
        "\n```";
    }

    try {
      await ctx.reply(body, { parse_mode: "Markdown" });
    } catch {
      // Markdown parser fails on stray underscores etc. — fall back to plain text.
      await ctx.reply(body);
    }
  } catch (err) {
    await ctx.reply(
      "Бот упал: " +
        (err instanceof Error ? err.message : String(err)).slice(0, 200),
    );
  }
}

bot.catch((err) => {
  console.error("[bot] error:", err.error);
});

void bot.start({
  onStart: (me) => {
    console.log(
      `[bot] @${me.username} is up. cwd=${config.claudeCwd}, whitelist=${[...config.allowedUserIds].join(",") || "(empty)"}`,
    );
  },
});
