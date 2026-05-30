// Translates English news headlines to RU + SK in a single gpt-4o-mini call.
// Wrapped by readNews() in snapshot.ts so the cost falls on the 30-min cache
// refresh, not on every page request. Failure mode: log + fallback all locale
// slots to the English original so the section still renders.

import OpenAI from "openai";
import type { NewsItem } from "./news";

const MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `You are a translator for renewable-energy news headlines.
Translate each English headline into Russian (ru) and Slovak (sk).

Rules:
- Preserve company names, ticker symbols, and units exactly (GWh, MW, MWh, kW, EV, BESS, IPO, IRA, EPA, DOE, FERC, EU).
- Keep numbers and currency symbols ($, €, £) as-is.
- Match the headline tone: concise, news-style, no trailing period.
- Output strict JSON only, no commentary.`;

type TranslationResponse = {
  ru: string[];
  sk: string[];
};

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI {
  if (!cachedClient) cachedClient = new OpenAI();
  return cachedClient;
}

export async function translateHeadlines(items: NewsItem[]): Promise<NewsItem[]> {
  if (items.length === 0) return items;
  const englishTitles = items.map((it) => it.title);

  try {
    const client = getClient();
    const res = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            headlines: englishTitles,
            locales: ["ru", "sk"],
            instructions:
              "Return {\"ru\": string[], \"sk\": string[]} with arrays positionally aligned to headlines.",
          }),
        },
      ],
    });

    const raw = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<TranslationResponse>;
    const ru = Array.isArray(parsed.ru) ? parsed.ru : [];
    const sk = Array.isArray(parsed.sk) ? parsed.sk : [];

    return items.map((it, i) => ({
      ...it,
      titles: {
        en: it.title,
        ru: typeof ru[i] === "string" && ru[i].trim().length > 0 ? ru[i] : it.title,
        sk: typeof sk[i] === "string" && sk[i].trim().length > 0 ? sk[i] : it.title,
      },
    }));
  } catch (err) {
    console.error(
      "[news] translateHeadlines failed:",
      err instanceof Error ? err.message : err,
    );
    return items.map((it) => ({
      ...it,
      titles: { en: it.title, ru: it.title, sk: it.title },
    }));
  }
}
