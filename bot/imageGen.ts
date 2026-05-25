import OpenAI from "openai";

export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536" | "auto";

export interface ImageResult {
  /** PNG buffer ready for `bot.api.sendPhoto(chat, new InputFile(buffer))`. */
  png: Buffer;
  /** The prompt that was actually sent (after any massaging). */
  finalPrompt: string;
}

/**
 * Generate a single image via OpenAI's image API.
 * Returns a PNG buffer ready to upload to Telegram.
 *
 * `gpt-image-1` is the current flagship model. It returns base64 PNG.
 */
export async function generateImage(
  prompt: string,
  openai: OpenAI,
  opts: { size?: ImageSize; quality?: "low" | "medium" | "high" } = {},
): Promise<ImageResult> {
  const finalPrompt = prompt.trim();
  if (finalPrompt.length === 0) {
    throw new Error("empty prompt");
  }
  const res = await openai.images.generate({
    model: "gpt-image-1",
    prompt: finalPrompt,
    size: opts.size ?? "1024x1024",
    quality: opts.quality ?? "medium",
    n: 1,
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("image API returned no b64_json");
  }
  return { png: Buffer.from(b64, "base64"), finalPrompt };
}

/**
 * Wrap a free-form description into a logo-oriented prompt — encourages flat
 * vector aesthetic, transparent or neutral background, no extraneous text.
 */
export function logoPrompt(description: string): string {
  return [
    "Vector-style minimal logo design.",
    description,
    "Clean lines, flat colors, balanced composition, no text.",
    "Centered on a neutral light background.",
  ].join(" ");
}
