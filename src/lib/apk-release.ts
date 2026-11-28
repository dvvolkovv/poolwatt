// Какая сборка Android лежит на отдаче. Нужна странице установки, чтобы
// рядом со ссылкой стоял номер сборки и размер файла, а не обещание.
//
// Каталог отдаётся nginx'ом (`/downloads/` → `/var/www/poolwatt-downloads/`),
// и наличие файла — единственный честный источник: если сборки нет, страница
// так и говорит, а не ведёт на 404.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const APK_DIR =
  process.env.APK_DOWNLOAD_DIR ?? "/var/www/poolwatt-downloads";
export const APK_LATEST_URL = "/downloads/poolwatt.apk";

export interface ApkRelease {
  /** Номер сборки из имени файла. */
  build: number;
  bytes: number;
  /** Мегабайты с одним знаком — столько, сколько человеку надо знать. */
  megabytes: string;
  url: string;
}

/** Самая свежая опубликованная сборка, или null, если каталога нет. */
export function readLatestApk(dir: string = APK_DIR): ApkRelease | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }

  let best: { build: number; name: string } | null = null;
  for (const name of names) {
    const match = /^poolwatt-build-(\d+)\.apk$/.exec(name);
    if (!match) continue;
    const build = Number(match[1]);
    if (!best || build > best.build) best = { build, name };
  }
  if (!best) return null;

  let bytes: number;
  try {
    bytes = statSync(join(dir, best.name)).size;
  } catch {
    return null;
  }

  return {
    build: best.build,
    bytes,
    megabytes: (bytes / 1_000_000).toFixed(1),
    url: APK_LATEST_URL,
  };
}
