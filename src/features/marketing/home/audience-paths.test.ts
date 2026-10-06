/**
 * The tiles show the first chapter of each field's path. The titles live in
 * the translations (the website is static and reads no database), so this
 * keeps them equal to the latest seed of each path in supabase/migrations.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import {
  AUDIENCE_PATH,
  AUDIENCE_PATHS,
  AUDIENCE_TILES,
  FIRST_CHAPTER_STEPS,
} from "./audience-paths";

const MIGRATIONS = path.resolve(__dirname, "../../../../supabase/migrations");

type Title = { cs: string; en: string };

function firstChapterSeeds(): Map<string, Map<number, Title>> {
  const seeds = new Map<string, Map<number, Title>>();
  const pattern = /seed_milestone\('([a-z_]+)',\s*1,\s*(\d+),[^\n]*\n\s*\$j\$(\{.*?\})\$j\$/g;
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const [, pathKey, position, title] of sql.matchAll(pattern)) {
      if (!seeds.has(pathKey!)) seeds.set(pathKey!, new Map());
      seeds.get(pathKey!)!.set(Number(position), JSON.parse(title!) as Title);
    }
  }
  return seeds;
}

const seeds = firstChapterSeeds();
const texts = { cs, en } as const;

describe("audience tiles", () => {
  it("every tile starts on a seeded path", () => {
    for (const tile of AUDIENCE_TILES) {
      expect(seeds.has(AUDIENCE_PATH[tile])).toBe(true);
    }
  });

  it.each(
    AUDIENCE_PATHS.flatMap((pathKey) =>
      (["cs", "en"] as const).map((lang) => [pathKey, lang] as const),
    ),
  )("%s in %s shows the seeded first chapter", (pathKey, lang) => {
    const seeded = seeds.get(pathKey)!;
    const shown = texts[lang].marketing.home.audience.paths[pathKey];
    FIRST_CHAPTER_STEPS.forEach((step, index) => {
      expect(shown[step]).toBe(seeded.get(index + 1)?.[lang]);
    });
  });
});
