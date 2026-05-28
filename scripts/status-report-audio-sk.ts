import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

import OpenAI from "openai";
import { writeFileSync } from "fs";

const report = `
Odporúčanie pre poštový systém pre Poolwatt.

Odporúčam použiť Resend — transakčné API na odosielanie e-mailov. Tu sú dôvody.

Po prvé. V projekte sú už pripravené premenné RESEND API KEY a RESEND FROM EMAIL. Projekt je na to od začiatku navrhnutý.

Po druhé. Resend výborne spolupracuje s Next.js a podporuje React Email — šablóny e-mailov sa píšu ako React komponenty, s typovaním a opätovným použitím.

Po tretie. Doručiteľnosť hneď z krabice. SPF a DKIM sa nastavujú jedným DNS záznamom. Nemusíte sledovať reputáciu IP adresy.

Po štvrté. Bezplatný tarif — tri tisíc e-mailov mesačne. To viac než stačí na Fázu dva.

Po piate. Žiadne zaťaženie servera. Váš jediný VPS už nesie Next.js, bota a worker. Spúšťať na ňom Postfix je zbytočné riziko a zbytočná práca naviac.

Prečo nie self-hosted Postfix? Jeden server, zdieľaný s aplikáciou — to je dodatočná útočná plocha. IP adresa sa môže dostať do spam listov a obnovenie reputácie je bolesť hlavy. Pre dve úlohy — obnovenie hesla a notifikácie — je to nadbytočné.

Pre prichádzajúcu poštu, ako napríklad support zavináč poolwatt bodka com, sa neskôr dá pripojiť Yandex tristošesťdesiat alebo jednoduchý forward.

Ak súhlasíte — pristupujem k detailnému dizajnu: architektúra, komponenty, šablóny e-mailov, integrácia s Auth bodka js. Koniec správy.
`.trim();

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY not set in .env.local");
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey });

  console.log("Generating Slovak audio report...");
  const res = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: report,
    response_format: "mp3",
  });

  const ab = await res.arrayBuffer();
  const outPath = "status-report-sk.mp3";
  writeFileSync(outPath, Buffer.from(ab));
  console.log(`Audio report saved to ${outPath} (${Buffer.from(ab).length} bytes)`);
}

main();
