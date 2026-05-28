import OpenAI from "openai";

// TTS output budget. Telegram caps voice messages at ~50MB, but generating a
// long take of speech wastes seconds and tokens. ~600 chars ≈ 30s of audio at
// normal pace — enough for a useful answer, short enough for snappy UX.
export const TTS_INPUT_CHAR_LIMIT = 600;

export interface TtsResult {
  /** OGG/Opus buffer — what Telegram expects for sendVoice. */
  ogg: Buffer;
  /** The (possibly truncated) text that was actually synthesized. */
  spokenText: string;
}

/**
 * Synthesize speech with OpenAI TTS. Returns an OGG/Opus buffer ready for
 * `bot.api.sendVoice(chat, new InputFile(buffer))`.
 *
 * The model `gpt-4o-mini-tts` is the lowest-latency option as of 2026-Q2;
 * `alloy` voice is neutral and works for both RU and EN content.
 */
export async function synthesizeVoice(
  text: string,
  openai: OpenAI,
): Promise<TtsResult> {
  const spokenText =
    text.length <= TTS_INPUT_CHAR_LIMIT
      ? text
      : text.slice(0, TTS_INPUT_CHAR_LIMIT) + "…";

  const res = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: spokenText,
    response_format: "opus",
  });
  const ab = await res.arrayBuffer();
  return { ogg: Buffer.from(ab), spokenText };
}

/**
 * Translate Russian status text to spoken Slovak, prepared for
 * `gpt-4o-mini-tts`. Adapts email addresses and dotted identifiers so the
 * TTS model reads them naturally — see CLAUDE.md "Bot response mode" for
 * the quirk this works around.
 */
export async function translateToSlovak(
  textRu: string,
  openai: OpenAI,
): Promise<string> {
  const trimmed = textRu.trim();
  if (!trimmed) return "";

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You translate short status messages from Russian to Slovak for a text-to-speech engine. " +
          "Return ONLY the Slovak translation — no quotes, no preface, no explanation. " +
          'Inside email addresses and dotted identifiers, spell "@" as "zavináč" and "." as "bodka" ' +
          '(so "Auth.js" → "Auth bodka js", "foo@bar.com" → "foo zavináč bar bodka com"). ' +
          "Keep numbers as digits. Keep the tone natural and concise.",
      },
      { role: "user", content: trimmed },
    ],
  });
  return (res.choices[0]?.message?.content ?? "").trim();
}
