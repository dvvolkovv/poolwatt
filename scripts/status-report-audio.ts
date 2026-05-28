import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

import OpenAI from "openai";
import { writeFileSync, readFileSync } from "fs";
import { translateToSlovak } from "../bot/tts";

// Status report generator: takes Russian text (from argv[2] file path or stdin)
// and produces TWO sibling MP3s — RU original + SK translation — per the
// bilingual rule in CLAUDE.md. Use as:
//   npx tsx scripts/status-report-audio.ts <input.txt> [<base-name>]
//   echo "..." | npx tsx scripts/status-report-audio.ts - [<base-name>]
// Defaults to base name "status-report" (→ status-report.mp3 + status-report-sk.mp3).

async function readInput(arg: string | undefined): Promise<string> {
  if (!arg || arg === "-") {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  return readFileSync(arg, "utf8").trim();
}

async function synth(openai: OpenAI, text: string, outPath: string) {
  const res = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: text,
    response_format: "mp3",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  console.log(`  → ${outPath} (${buf.length} bytes)`);
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY not set in .env.local");
    process.exit(1);
  }

  const inputArg = process.argv[2];
  const baseName = process.argv[3] || "status-report";
  const reportRu = await readInput(inputArg);
  if (!reportRu) {
    console.error("Empty input. Pass a file path or pipe text via stdin.");
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey });

  console.log("RU TTS…");
  await synth(openai, reportRu, `${baseName}.mp3`);

  console.log("RU → SK translation…");
  const reportSk = await translateToSlovak(reportRu, openai);
  if (!reportSk) {
    console.error("Slovak translation returned empty — skipping SK file.");
    process.exit(2);
  }
  console.log("SK TTS…");
  await synth(openai, reportSk, `${baseName}-sk.mp3`);

  console.log("Done.");
}

main();
