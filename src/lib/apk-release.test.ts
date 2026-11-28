import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLatestApk } from "./apk-release";

let dirs: string[] = [];

function dirWith(files: Record<string, number>): string {
  const dir = mkdtempSync(join(tmpdir(), "apk-"));
  dirs.push(dir);
  for (const [name, size] of Object.entries(files)) {
    writeFileSync(join(dir, name), Buffer.alloc(size));
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("readLatestApk", () => {
  it("берёт сборку с наибольшим номером, а не последнюю по алфавиту", () => {
    // По алфавиту «build-9» идёт после «build-11» — отсюда и тест.
    const dir = dirWith({
      "poolwatt-build-9.apk": 10,
      "poolwatt-build-11.apk": 4_072_490,
    });
    expect(readLatestApk(dir)?.build).toBe(11);
  });

  it("считает размер в мегабайтах с одним знаком", () => {
    const dir = dirWith({ "poolwatt-build-1.apk": 4_072_490 });
    const release = readLatestApk(dir);
    expect(release?.bytes).toBe(4_072_490);
    expect(release?.megabytes).toBe("4.1");
  });

  it("отдаёт адрес последней сборки, а не версионный", () => {
    const dir = dirWith({ "poolwatt-build-3.apk": 5 });
    expect(readLatestApk(dir)?.url).toBe("/downloads/poolwatt.apk");
  });

  it("чужие файлы в каталоге не считает сборкой", () => {
    const dir = dirWith({ "poolwatt.apk": 5, "readme.txt": 1 });
    expect(readLatestApk(dir)).toBeNull();
  });

  it("нет каталога — нет сборки, и это не ошибка", () => {
    expect(
      readLatestApk(join(tmpdir(), "poolwatt-no-such-dir-xyz")),
    ).toBeNull();
  });
});
