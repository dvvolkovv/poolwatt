import { MOCK_PRODUCERS } from "../src/lib/producers";
import { readGridStats, readGreenIndex } from "../src/lib/snapshot";
import {
  renderProducerShort,
  renderProducerDetail,
  renderGridStats,
  escapeMd,
} from "./format";
import type { ClaudeRunner } from "./claudeRunner";
import type { SessionStore } from "./session";
import type OpenAI from "openai";
import { generateImage, logoPrompt } from "./imageGen";

export type Reply = (text: string, opts?: { parseMode?: "MarkdownV2" }) => Promise<unknown>;

/** Sends a photo. Defined as a callback so commands.ts doesn't import grammy. */
export type PhotoReply = (png: Buffer, caption?: string) => Promise<unknown>;

export type CommandDeps = {
  webBaseUrl: string;
  /** caller's preferred locale — used to build deep links inside messages */
  locale: string;
  /** Telegram user id of the caller. */
  userId: number;
  /** Whether the caller is on the dev-commands whitelist. */
  isAuthorized: boolean;
  session: SessionStore;
  runner: ClaudeRunner;
  /** Null when OPENAI_API_KEY is unset — used by /image and /logo. */
  openai: OpenAI | null;
  /** Sends a PNG as a photo with optional caption. */
  sendPhoto: PhotoReply;
};

type CommandHandler = (args: string[], reply: Reply, deps: CommandDeps) => Promise<void>;

const HELP_TEXT = [
  "*Poolwatt* — P2P маркетплейс возобновляемой энергии",
  "",
  "*Маркетплейс:*",
  "· /start — приветствие",
  "· /help — это сообщение",
  "· /producers — топ\\-10 производителей сейчас",
  "· /producer `<handle>` — полный профиль производителя",
  "· /grid — сводка по сети",
  "· /greenindex — текущий Green Index",
  "· /watch `<handle>` — добавить в избранное",
  "· /unwatch `<handle>` — убрать из избранного",
  "· /buy `<handle>` `<квт·ч>` — оформить предложение покупки",
  "· /listing — подать заявку на листинг своего домохозяйства",
  "· /whoami — показать твой Telegram user id",
  "",
  "*Dev \\(только для whitelisted\\):*",
  "· _свободный текст_ — задача для Claude в репо",
  "· _голосовое_ — Whisper расшифрует и обработает как текст \\(ответит и текстом, и голосом\\)",
  "· /image `<prompt>` — сгенерить картинку",
  "· /logo `<описание>` — сгенерить лого \\(минималистичный вектор\\)",
  "· /new — сбросить текущую сессию Claude",
  "· /cancel — остановить активную задачу",
  "· /verbose — переключить подробный вывод каждого tool call'а",
  "· /status — состояние текущей сессии",
].join("\n");

export const handlers: Record<string, CommandHandler> = {
  "/start": async (_args, reply, _deps) => {
    await reply(
      [
        "*Привет, это Poolwatt*",
        "",
        "Peer\\-to\\-peer маркетплейс, где домохозяйства продают электричество из возобновляемых источников, накопленное в powerbank'ах\\.",
        "",
        "Отправь /help чтобы увидеть команды\\.",
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
    await reply(`*Топ производителей Poolwatt*\n\n${body}`, { parseMode: "MarkdownV2" });
  },

  "/producer": async (args, reply, deps) => {
    const handle = (args[0] ?? "").replace(/^@/, "").trim();
    if (!handle) {
      await reply("Использование: /producer `<handle>`", { parseMode: "MarkdownV2" });
      return;
    }
    const p = MOCK_PRODUCERS.find((x) => x.handle === handle);
    if (!p) {
      await reply(`Производитель \`${escapeMd(handle)}\` не найден\\.`, {
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
      await reply("Телеметрия сети недоступна\\.", { parseMode: "MarkdownV2" });
      return;
    }
    await reply(renderGridStats(stats, gi), { parseMode: "MarkdownV2" });
  },

  "/greenindex": async (_args, reply) => {
    const gi = await readGreenIndex();
    if (!gi) {
      await reply("Green Index недоступен\\.", { parseMode: "MarkdownV2" });
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
      await reply("Использование: /watch `<handle>`", { parseMode: "MarkdownV2" });
      return;
    }
    await reply(`Добавил \`${escapeMd(handle)}\` в избранное\\.`, {
      parseMode: "MarkdownV2",
    });
  },

  "/unwatch": async (args, reply) => {
    const handle = (args[0] ?? "").replace(/^@/, "").trim();
    if (!handle) {
      await reply("Использование: /unwatch `<handle>`", { parseMode: "MarkdownV2" });
      return;
    }
    await reply(`Убрал \`${escapeMd(handle)}\` из избранного\\.`, {
      parseMode: "MarkdownV2",
    });
  },

  "/buy": async (args, reply) => {
    const handle = (args[0] ?? "").replace(/^@/, "").trim();
    const kwh = Number(args[1]);
    if (!handle || !Number.isFinite(kwh) || kwh <= 0) {
      await reply("Использование: /buy `<handle>` `<квт·ч>`", { parseMode: "MarkdownV2" });
      return;
    }
    const p = MOCK_PRODUCERS.find((x) => x.handle === handle);
    if (!p) {
      await reply(`Производитель \`${escapeMd(handle)}\` не найден\\.`, {
        parseMode: "MarkdownV2",
      });
      return;
    }
    if (kwh > p.availableKwh) {
      await reply(
        `У \`${escapeMd(handle)}\` сейчас доступно только ${escapeMd(p.availableKwh.toFixed(2))} кВт·ч\\.`,
        { parseMode: "MarkdownV2" },
      );
      return;
    }
    const totalUsd = (kwh * p.pricePerKwhUsd).toFixed(2);
    await reply(
      [
        "*Предложение покупки* — превью",
        "",
        `· Производитель: ${escapeMd(p.displayName)} \\(\`${escapeMd(p.handle)}\`\\)`,
        `· Объём: *${escapeMd(kwh.toFixed(2))} кВт·ч*`,
        `· Цена: *${escapeMd(p.pricePerKwhUsd.toFixed(3))} USD/кВт·ч*`,
        `· Итого: *${escapeMd(totalUsd)} USD*`,
        "",
        "Подтверждение пойдёт через веб\\-портал — подпись кошельком появится в Phase 3\\.",
      ].join("\n"),
      { parseMode: "MarkdownV2" },
    );
  },

  "/listing": async (_args, reply, deps) => {
    await reply(
      [
        "*Листинг своего домохозяйства на Poolwatt*",
        "",
        "1\\. Убедись, что твой powerbank заряжается из возобновляемого источника \\(солнце/ветер/гидро/биомасса\\)\\.",
        "2\\. Подготовь модель и мощность инвертора\\.",
        "3\\. Подай заявку:",
        escapeMd(`${deps.webBaseUrl}/${deps.locale}/request`),
      ].join("\n"),
      { parseMode: "MarkdownV2" },
    );
  },

  "/whoami": async (_args, reply, deps) => {
    await reply(`Твой Telegram user id: \`${deps.userId}\``, {
      parseMode: "MarkdownV2",
    });
  },

  "/new": async (_args, reply, deps) => {
    if (!deps.isAuthorized) {
      await reply("Нет доступа\\.", { parseMode: "MarkdownV2" });
      return;
    }
    deps.session.reset(deps.userId);
    await reply("Новая сессия — следующее сообщение начнёт с чистого листа\\.", {
      parseMode: "MarkdownV2",
    });
  },

  "/cancel": async (_args, reply, deps) => {
    if (!deps.isAuthorized) {
      await reply("Нет доступа\\.", { parseMode: "MarkdownV2" });
      return;
    }
    if (deps.runner.isActive(deps.userId)) {
      deps.runner.cancel(deps.userId);
      await reply("Отменяю текущую задачу…", { parseMode: "MarkdownV2" });
    } else {
      await reply("Нечего отменять — активной задачи нет\\.", {
        parseMode: "MarkdownV2",
      });
    }
  },

  "/verbose": async (_args, reply, deps) => {
    if (!deps.isAuthorized) {
      await reply("Нет доступа\\.", { parseMode: "MarkdownV2" });
      return;
    }
    const current = deps.session.getVerbose(deps.userId);
    deps.session.setVerbose(deps.userId, !current);
    await reply(
      !current
        ? "Verbose режим *вкл* — увидишь каждый tool call отдельным сообщением\\."
        : "Verbose режим *выкл*\\.",
      { parseMode: "MarkdownV2" },
    );
  },

  "/image": async (args, reply, deps) => {
    if (!deps.isAuthorized) {
      await reply("Нет доступа\\.", { parseMode: "MarkdownV2" });
      return;
    }
    if (!deps.openai) {
      await reply("OPENAI\\_API\\_KEY не задан — генерация картинок недоступна\\.", {
        parseMode: "MarkdownV2",
      });
      return;
    }
    const prompt = args.join(" ").trim();
    if (!prompt) {
      await reply("Использование: /image `<описание картинки>`", { parseMode: "MarkdownV2" });
      return;
    }
    await reply("🎨 рисую\\.\\.\\.", { parseMode: "MarkdownV2" });
    try {
      const { png } = await generateImage(prompt, deps.openai);
      await deps.sendPhoto(png, prompt.length > 200 ? prompt.slice(0, 200) + "…" : prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await reply(`Не получилось сгенерить: ${escapeMd(msg.slice(0, 200))}`, {
        parseMode: "MarkdownV2",
      });
    }
  },

  "/logo": async (args, reply, deps) => {
    if (!deps.isAuthorized) {
      await reply("Нет доступа\\.", { parseMode: "MarkdownV2" });
      return;
    }
    if (!deps.openai) {
      await reply("OPENAI\\_API\\_KEY не задан — генерация картинок недоступна\\.", {
        parseMode: "MarkdownV2",
      });
      return;
    }
    const desc = args.join(" ").trim();
    if (!desc) {
      await reply("Использование: /logo `<описание>`", { parseMode: "MarkdownV2" });
      return;
    }
    await reply("🎨 рисую лого\\.\\.\\.", { parseMode: "MarkdownV2" });
    try {
      const wrapped = logoPrompt(desc);
      const { png } = await generateImage(wrapped, deps.openai, {
        size: "1024x1024",
        quality: "high",
      });
      await deps.sendPhoto(png, `Лого: ${desc.length > 180 ? desc.slice(0, 180) + "…" : desc}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await reply(`Не получилось сгенерить: ${escapeMd(msg.slice(0, 200))}`, {
        parseMode: "MarkdownV2",
      });
    }
  },

  "/status": async (_args, reply, deps) => {
    if (!deps.isAuthorized) {
      await reply("Нет доступа\\.", { parseMode: "MarkdownV2" });
      return;
    }
    const rec = deps.session.get(deps.userId);
    const running = deps.runner.isActive(deps.userId);
    if (!rec) {
      await reply(
        running
          ? "В памяти нет сессии, но процесс claude запущен \\(странно\\)\\."
          : "Активной сессии нет\\. Отправь свободный текст — начнём с нуля\\.",
        { parseMode: "MarkdownV2" },
      );
      return;
    }
    const sinceSec = Math.round((Date.now() - rec.lastActivity) / 1000);
    await reply(
      [
        `session\\_id: \`${escapeMd(rec.claudeSessionId)}\``,
        `последняя активность: *${sinceSec}с назад*`,
        `процесс claude: *${running ? "запущен" : "idle"}*`,
      ].join("\n"),
      { parseMode: "MarkdownV2" },
    );
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
