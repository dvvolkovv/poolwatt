// Minimal cyrillic + slovak diacritic transliteration. Not exhaustive —
// extend the map if a user reports a missing character. Lossy for chars
// not in the map (they're stripped).
const TRANSLIT: Record<string, string> = {
  // Cyrillic
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",й:"y",
  к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",
  х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
  // Ukrainian extras
  є:"ye",і:"i",ї:"yi",ґ:"g",
  // Slovak diacritics
  á:"a",ä:"a",č:"c",ď:"d",é:"e",í:"i",ĺ:"l",ľ:"l",ň:"n",ó:"o",ô:"o",
  ŕ:"r",š:"s",ť:"t",ú:"u",ý:"y",ž:"z",
  // German / common
  ö:"o",ü:"u",ß:"ss",
};

export function slugify(input: string): string {
  const lower = input.toLowerCase();
  const ascii = Array.from(lower).map((ch) => TRANSLIT[ch] ?? ch).join("");
  const slug = ascii
    // collapse abbreviations like s.r.o. → sro (letter-dot sequences)
    .replace(/\b([a-z])\.([a-z]\.)*/g, (m) => m.replace(/\./g, ""))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "x";
}
