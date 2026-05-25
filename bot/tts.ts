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
