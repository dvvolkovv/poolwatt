// Добивает словари переводов до полного комплекта.
//
// Владелец 2026-11-28: «взял язык интерфейса — надеюсь, интерфейс полностью
// будет на том языке». До этого полными были только английский, русский и
// словацкий; у остальных 26 языков было по 273 строки из 2576, и всё
// остальное показывалось по-английски.
//
// Источник правды — `messages/en.json`. Скрипт берёт только те ключи,
// которых у языка нет, и не трогает ни одной уже переведённой строки: ручную
// правку переводчика он не затрёт. Запускать можно сколько угодно раз.
//
//   npx tsx scripts/translate-messages.ts            # все языки
//   npx tsx scripts/translate-messages.ts de pl      # только эти
//
// Подстановки вида `{days}` проверяются после перевода: если модель их
// потеряла или переименовала, строка остаётся английской — лучше английское
// слово, чем сломанная страница.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { config as loadEnv } from "dotenv";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "../src/lib/locales";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const DIR = join(process.cwd(), "messages");
const MODEL = "gpt-4o-mini";
const CHUNK = 40;
const PARALLEL = 6;

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

function setPath(tree: Tree, path: string, value: string): void {
  const parts = path.split(".");
  let node = tree;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part] as Tree;
  }
  node[parts[parts.length - 1]] = value;
}

const placeholders = (text: string): string[] =>
  (text.match(/\{[^}]+\}/g) ?? []).sort();

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const SYSTEM = [
  "You translate the user interface of Poolwatt — a peer-to-peer marketplace",
  "for renewable energy from households, with an EV-charging network, a wallet",
  "and an exchange. The input is a JSON object of key → {en, ru}: the English",
  "string and its Russian translation, which is complete and authoritative.",
  "Translate the *meaning* both carry; when the English word is ambiguous, the",
  "Russian settles it (\"Cabinet\"/\"Кабинет\" is the person's own account area,",
  "not a piece of furniture).",
  "Return a JSON object with exactly the same keys and, as each value, one",
  "plain translated string — never an object.",
  "",
  "Example. Input:",
  '  {"common.signIn": {"en": "Sign in", "ru": "Войти"}}',
  "Output for German:",
  '  {"common.signIn": "Anmelden"}',
  "",
  "Glossary — the words this product uses in its own way:",
  '  "Cabinet" is the signed-in person\'s own area of the site ("My account"),',
  "  not a piece of furniture and not a room;",
  '  "Hub" is an aggregator that buys energy; "Producer" is a household that',
  "  sells it; \"Offer\" is kWh put up for sale in a time window.",
  "",
  "Rules:",
  "- Keep every placeholder in braces exactly as it is: {days}, {count}, {name}.",
  "- Keep these untranslated: Poolwatt, Taler ID, Telegram, IBAN, QR, kWh, kW,",
  "  CO₂, OCPP, DATEV, BMD, SEPA, API, PDF, CSV, EUR, USD.",
  "- These are interface labels: keep them as short as the English, no fuller.",
  "- Keep the capitalisation style and the punctuation of the original.",
  "- Translate nothing into English: the target language only.",
  "- No explanations, no extra keys, no markdown — JSON only.",
].join("\n");

type Source = { en: string; ru: string };

async function translateChunk(
  openai: OpenAI,
  locale: Locale,
  entries: Record<string, Source>,
): Promise<Record<string, string>> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Target language: ${LOCALE_LABELS[locale]} (${locale}).\n\n${JSON.stringify(entries, null, 1)}`,
      },
    ],
  });
  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, source] of Object.entries(entries)) {
    const raw = parsed[key];
    // Модель охотно отвечает объектом — {"pl": "…"} вместо строки.
    const value =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object"
          ? Object.values(raw as Record<string, unknown>).find(
              (v): v is string => typeof v === "string",
            )
          : undefined;
    if (typeof value !== "string" || value.trim() === "") continue;
    // Потерянная или переименованная подстановка — это сломанная страница.
    if (!same(placeholders(value), placeholders(source.en))) continue;
    out[key] = value;
  }
  return out;
}

async function runLocale(
  openai: OpenAI,
  locale: Locale,
  source: Record<string, Source>,
) {
  const path = join(DIR, `${locale}.json`);
  const tree = JSON.parse(readFileSync(path, "utf8")) as Tree;
  const own = flatten(tree);
  let missing = Object.keys(source).filter((key) => !(key in own));
  if (missing.length === 0) {
    console.log(`${locale}: полный, трогать нечего`);
    return;
  }
  const total = missing.length;
  console.log(`${locale}: нет ${total} строк`);

  let kept = 0;
  // Второй проход для того, что не вернулось или вернулось битым: один
  // потерянный ключ — это одна английская надпись посреди чужого языка.
  for (let attempt = 1; attempt <= 2 && missing.length > 0; attempt++) {
    const chunks: Record<string, Source>[] = [];
    for (let i = 0; i < missing.length; i += CHUNK) {
      chunks.push(Object.fromEntries(missing.slice(i, i + CHUNK).map((k) => [k, source[k]])));
    }

    let done = 0;
    for (let i = 0; i < chunks.length; i += PARALLEL) {
      const batch = chunks.slice(i, i + PARALLEL);
      const results = await Promise.all(
        batch.map((chunk) =>
          translateChunk(openai, locale, chunk).catch((error) => {
            console.warn(`${locale}: кусок не перевёлся — ${String(error).slice(0, 80)}`);
            return {} as Record<string, string>;
          }),
        ),
      );
      for (const result of results) {
        for (const [key, value] of Object.entries(result)) {
          setPath(tree, key, value);
          kept++;
        }
      }
      done += batch.length;
      // Пишем на каждом шаге: длинный прогон не должен пропасть целиком.
      writeFileSync(path, `${JSON.stringify(tree, null, 2)}\n`, "utf8");
      process.stdout.write(`  ${locale}: заход ${attempt}, ${done}/${chunks.length}\r`);
    }

    const after = flatten(tree);
    missing = missing.filter((key) => !(key in after));
  }
  console.log(`${locale}: переведено ${kept} из ${total}${missing.length ? `, осталось ${missing.length}` : ""}`);
}

async function main() {
  const asked = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const targets = (asked.length ? asked : SUPPORTED_LOCALES).filter(
    (l): l is Locale => SUPPORTED_LOCALES.includes(l as Locale) && l !== "en",
  );
  const en = flatten(JSON.parse(readFileSync(join(DIR, "en.json"), "utf8")) as Tree);
  const ru = flatten(JSON.parse(readFileSync(join(DIR, "ru.json"), "utf8")) as Tree);
  const source: Record<string, Source> = {};
  for (const [key, value] of Object.entries(en)) {
    source[key] = { en: value, ru: ru[key] ?? value };
  }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log(`Английский: ${Object.keys(en).length} строк. Языков: ${targets.length}.`);
  for (const locale of targets) {
    await runLocale(openai, locale, source);
  }
  console.log("Готово.");
}

void main();
