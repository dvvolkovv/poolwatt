import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

import { describe, it, expect } from "vitest";
import OpenAI from "openai";
import { translateToSlovak } from "../tts";

const apiKey = process.env.OPENAI_API_KEY;
const describeIfKey = apiKey ? describe : describe.skip;

describeIfKey("translateToSlovak", () => {
  const openai = new OpenAI({ apiKey });

  it("translates a short Russian sentence to Slovak", async () => {
    const sk = await translateToSlovak("Готово.", openai);
    expect(sk).toBeTruthy();
    expect(sk.length).toBeGreaterThan(0);
    // "Hotovo" is the canonical Slovak rendering of "Готово" / "Done".
    // Match permissively — other valid translations are "Dokončené",
    // "Vykonané" etc. We just want to confirm the model returned Slovak,
    // not echoed Russian or English.
    expect(sk).toMatch(/hotov|dokonč|vykonan|spravené/i);
    expect(sk).not.toMatch(/готово|done/i);
  }, 30000);

  it("translates a longer status sentence to Slovak", async () => {
    const sk = await translateToSlovak(
      "Задача шла дольше 5 минут, остановил по таймауту.",
      openai,
    );
    expect(sk).toBeTruthy();
    expect(sk.length).toBeGreaterThan(10);
    expect(sk).not.toMatch(/задач|таймаут.*шла/i);
  }, 30000);
});
