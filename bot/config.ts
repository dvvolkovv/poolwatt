import { config as loadDotenv } from "dotenv";

// Load .env first (committed defaults), then .env.local (uncommitted overrides).
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

export type BotConfig = {
  telegramBotToken: string;
  /** Telegram user IDs allowed to run free-form Claude prompts and dev commands. */
  allowedUserIds: Set<number>;
  /** Base URL of the Poolwatt web app (used to build deep links inside messages). */
  webBaseUrl: string;
  /** Working directory Claude operates in. Should be the live checkout. */
  claudeCwd: string;
  /** Watchdog timeout for a single Claude run. Long builds/tests need headroom. */
  claudeTimeoutMs: number;
  /** OpenAI key used by voice (Whisper STT + TTS) and image generation. */
  openaiApiKey: string | null;
};

function parseIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const n = Number(s);
        if (!Number.isInteger(n)) {
          throw new Error(`Non-integer in BOT_ALLOWED_USER_IDS: "${s}"`);
        }
        return n;
      }),
  );
}

export function loadConfig(): BotConfig {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  // Accept BOT_ALLOWED_USER_IDS (preferred, matches trientes) and fall back to
  // the legacy BOT_ADMIN_USER_IDS so existing .env.local keeps working.
  const idsRaw =
    process.env.BOT_ALLOWED_USER_IDS ?? process.env.BOT_ADMIN_USER_IDS ?? "";
  return {
    telegramBotToken: token,
    allowedUserIds: parseIds(idsRaw),
    webBaseUrl: process.env.NEXTAUTH_URL ?? "https://poolwatt.com",
    claudeCwd: process.env.CLAUDE_CWD ?? process.cwd(),
    claudeTimeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS ?? 1_800_000),
    // Voice (in/out) and image generation are optional. If the key is missing
    // we degrade gracefully — those features return a friendly error message.
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
  };
}
