import { config as loadDotenv } from "dotenv";

// Load .env first (committed defaults), then .env.local (uncommitted overrides).
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

export type BotConfig = {
  telegramBotToken: string;
  /** Comma-separated Telegram user IDs that get sudo-grade commands (/grant, /broadcast, …). */
  adminUserIds: number[];
  /** Base URL of the Poolwatt web app (used to build deep links inside messages). */
  webBaseUrl: string;
};

export function loadConfig(): BotConfig {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  const adminUserIds = (process.env.BOT_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = Number(s);
      if (!Number.isFinite(n)) throw new Error(`Invalid BOT_ADMIN_USER_IDS entry: "${s}"`);
      return n;
    });
  return {
    telegramBotToken: token,
    adminUserIds,
    webBaseUrl: process.env.NEXTAUTH_URL ?? "https://poolwatt.com",
  };
}
