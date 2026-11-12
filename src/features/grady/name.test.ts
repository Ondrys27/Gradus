// The assistant is called Grady (26.1, after Gradus); until then he was
// Jarvis. No text for users may say Jarvis any more, in either language,
// and the code calls him Grady too. What stays is listed here with the
// reason: database names (tables, columns, functions, app_settings keys,
// analytics events, unlock keys) are lowercase `jarvis…` and never flagged;
// a line that says "DB name kept from Jarvis" explains itself.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";

const SRC = path.resolve(__dirname, "../..");

/** Files that may say Jarvis, and why. Paths from src/. */
const ALLOWED_FILES: Readonly<Record<string, string>> = {
  "features/grady/name.test.ts": "this guard",
  "features/grady/prompt.ts": "the persona tells the model it used to be called Jarvis",
  "features/grady/prompt.test.ts": "tests of that",
  "features/game/skill-text.ts": "the skills' stored descriptions still say Jarvis",
  "features/plan/assistant-name.ts": "the first published catalog's stored card texts still say Jarvis",
  "features/plan/assistant-name.test.ts": "tests of that",
  "features/game/skill-text.test.ts": "a stored description as a fixture",
  "lib/supabase/plan-catalog-schema.test.ts": "the first published catalog still says Jarvis",
  "app/api/jarvis/route.ts": "the old address of the route",
  "lib/routes.ts": "the old address of Settings → Grady",
  "types/database.ts": "generated from the database",
};
const ALLOWED_LINE = /DB name kept from Jarvis/;

/**
 * Translation keys that keep "jarvis" because they are built from a stored
 * identifier: metric keys, tutorial step keys (profiles.tutorial.step) and
 * the analytics section of the administration.
 */
const KEPT_KEYS: readonly RegExp[] = [
  /^metrics\.items\.[a-z_]*jarvis[a-z_]*$/,
  /^tutorial\.steps\.jarvis(Ask|Frequency)?$/,
  /^admin\.users\.sections\.jarvis$/,
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|css|mjs|md)$/.test(name)) out.push(full);
  }
  return out;
}

type Messages = { [key: string]: string | Messages };

function entries(messages: Messages, prefix: string[] = []): { key: string; value: string }[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "string"
      ? [{ key: [...prefix, key].join("."), value }]
      : [{ key: [...prefix, key].join("."), value: "" }, ...entries(value, [...prefix, key])],
  );
}

describe("the assistant's name", () => {
  for (const [lang, messages] of [
    ["cs", cs],
    ["en", en],
  ] as const) {
    it(`is Grady in every text of ${lang}.json`, () => {
      const offenders = entries(messages as Messages)
        .filter(({ value }) => /jarvis/i.test(value))
        .map(({ key, value }) => `${key}: ${value}`);
      expect(offenders).toEqual([]);
    });

    it(`is grady in the translation keys of ${lang}.json, except those built from stored identifiers`, () => {
      const offenders = entries(messages as Messages)
        .map(({ key }) => key)
        .filter((key) => /jarvis/i.test(key.split(".").at(-1) ?? ""))
        .filter((key) => !KEPT_KEYS.some((kept) => kept.test(key)));
      expect(offenders).toEqual([]);
    });
  }

  it("is Grady everywhere in src/, outside the listed exceptions", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relative = path.relative(SRC, file).split(path.sep).join("/");
      if (relative in ALLOWED_FILES) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/Jarvis/.test(line) && !ALLOWED_LINE.test(line)) {
            offenders.push(`${relative}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("lists only exceptions that still exist", () => {
    for (const relative of Object.keys(ALLOWED_FILES)) {
      expect(statSync(path.join(SRC, relative)).isFile(), relative).toBe(true);
    }
  });

  it("catches the old name in any Czech form", () => {
    for (const text of ["Zeptej se Jarvise", "Napiš Jarvisovi", "s Jarvisem", "Jarvisova bublina"]) {
      expect(/Jarvis/.test(text)).toBe(true);
    }
  });
});
