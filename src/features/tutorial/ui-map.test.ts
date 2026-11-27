import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { sectionPlace } from "./guide/sections";
import { SECTION_GUIDES, UI_MAP, UI_MAP_BY_KEY, UI_MAP_EXEMPT, UI_MAP_VERSION } from "./ui-map";
import { GUIDE_SECTIONS } from "./ui-map/types";

/**
 * The catalog of controls (30.8) and the app say the same: every key of
 * ui-map is a `data-tutorial` somewhere in the app and every `data-tutorial`
 * of the app is in ui-map (or named as no guide's target), every element has
 * its texts in both languages, and every guide is made of the catalog's own
 * elements of its section.
 */

type Messages = { [key: string]: string | Messages };

function lookup(messages: Messages, key: string): string | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  return typeof node === "string" ? node : undefined;
}

const SRC = path.resolve(__dirname, "../..");

function files(dir: string): { file: string; code: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx$/.test(name) && !/\.test\./.test(name)
      ? [{ file: path.relative(SRC, full), code: readFileSync(full, "utf8") }]
      : [];
  });
}

/** The expression of a `data-tutorial={…}`, up to its closing brace. */
function expressionAt(code: string, start: number): string {
  let depth = 0;
  for (let index = start; index < code.length; index += 1) {
    const char = code[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(start + 1, index);
    }
  }
  return "";
}

/** The keys the app marks: literals and, from template strings, the family's start. */
function codeKeys() {
  const keys = new Map<string, string>();
  const prefixes = new Map<string, string>();
  for (const { file, code } of files(SRC)) {
    // A selector in a string (`[data-tutorial="…"]`) is no mark.
    for (const match of code.matchAll(/(?<![[\w-])data-tutorial="([^"]+)"/g)) keys.set(match[1]!, file);
    for (const match of code.matchAll(/(?<![[\w-])data-tutorial=\{/g)) {
      const expression = expressionAt(code, match.index! + "data-tutorial=".length);
      // Keys have a hyphen; a bare word is a value compared with (`tab === "recurring"`).
      for (const literal of expression.matchAll(/"([a-z0-9]+(?:-[a-z0-9]+)+)"/g)) keys.set(literal[1]!, file);
      for (const template of expression.matchAll(/`([a-z0-9-]*)\$\{/g)) prefixes.set(template[1]!, file);
    }
  }
  return { keys, prefixes };
}

const CODE = codeKeys();
const MAP_KEYS = UI_MAP.filter((element) => !element.prefix).map((element) => element.key);
const MAP_PREFIXES = UI_MAP.filter((element) => element.prefix).map((element) => element.key);

describe("ui-map", () => {
  it("has every key once", () => {
    const keys = UI_MAP.map((element) => element.key);
    expect(keys.length).toBe(new Set(keys).size);
    expect(UI_MAP.length).toBeGreaterThan(300);
  });

  it("every key of the catalog is in the app", () => {
    const missing = MAP_KEYS.filter((key) => !CODE.keys.has(key) && !MAP_PREFIXES.some((prefix) => key.startsWith(prefix)));
    expect(missing).toEqual([]);
    expect(MAP_PREFIXES.filter((prefix) => !CODE.prefixes.has(prefix))).toEqual([]);
  });

  it("every data-tutorial of the app is in the catalog", () => {
    const unknown = [...CODE.keys.keys()].filter(
      (key) =>
        !UI_MAP_BY_KEY.has(key) &&
        !(key in UI_MAP_EXEMPT) &&
        !MAP_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
    expect(unknown.map((key) => `${key} (${CODE.keys.get(key)})`)).toEqual([]);
    const families = [...CODE.prefixes.keys()].filter((prefix) => !MAP_PREFIXES.includes(prefix));
    expect(families.map((prefix) => `${prefix}… (${CODE.prefixes.get(prefix)})`)).toEqual([]);
  });

  it("names nothing exempt that is in the catalog, and only keys the app has", () => {
    for (const key of Object.keys(UI_MAP_EXEMPT)) {
      expect(UI_MAP_BY_KEY.has(key), key).toBe(false);
      expect(CODE.keys.has(key), key).toBe(true);
    }
  });

  it("opens only the catalog's own elements first, of the same section, never a family", () => {
    for (const element of UI_MAP) {
      for (const key of element.via ?? []) {
        const before = UI_MAP_BY_KEY.get(key);
        expect(before, `${element.key} via ${key}`).toBeDefined();
        expect(before!.prefix, `${element.key} via ${key}`).toBeFalsy();
        expect(key, element.key).not.toBe(element.key);
      }
      expect(element.path === "" || /^\/(app|admin)(\/|\?|$)/.test(element.path), element.key).toBe(true);
    }
  });

  it("has the name and purpose of every element in both languages", () => {
    const missing: string[] = [];
    for (const key of MAP_KEYS) {
      for (const [locale, messages] of [["cs", cs], ["en", en]] as const) {
        for (const field of ["name", "purpose", "keywords"]) {
          const text = lookup(messages as Messages, `tutorial.ui.${key}.${field}`);
          if (!text?.trim()) missing.push(`${locale} ${key}.${field}`);
        }
        const name = lookup(messages as Messages, `tutorial.ui.${key}.name`) ?? "";
        if (name.length > 40) missing.push(`${locale} ${key}.name is long`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("changes its version with what it says", () => {
    expect(UI_MAP_VERSION).toMatch(/^m[0-9a-z]{1,12}$/);
  });
});

describe("section guides", () => {
  it("every section has one guide with its texts", () => {
    expect(SECTION_GUIDES.map((guide) => guide.section).sort()).toEqual([...GUIDE_SECTIONS].sort());
    for (const section of GUIDE_SECTIONS) {
      for (const [locale, messages] of [["cs", cs], ["en", en]] as const) {
        for (const field of ["name", "intro", "examples.q1", "examples.q2", "examples.q3"]) {
          expect(lookup(messages as Messages, `tutorial.guides.${section}.${field}`), `${locale} ${section}.${field}`).toBeTruthy();
        }
      }
      expect(sectionPlace(section).path, section).toMatch(/^\/(app|admin)/);
    }
  });

  it("the quick look has 5–8 elements of the page itself, only looking", () => {
    for (const guide of SECTION_GUIDES) {
      expect(guide.quick.length, guide.section).toBeGreaterThanOrEqual(5);
      expect(guide.quick.length, guide.section).toBeLessThanOrEqual(8);
      for (const key of guide.quick) {
        const element = UI_MAP_BY_KEY.get(key);
        expect(element, `${guide.section}: ${key}`).toBeDefined();
        expect(element!.via ?? [], `${guide.section}: ${key}`).toEqual([]);
        expect(element!.section, `${guide.section}: ${key}`).toBe(guide.section);
      }
    }
  });

  it("the full guide goes through every element of its section, with a text for each try", () => {
    for (const guide of SECTION_GUIDES) {
      const inGuide = new Set(guide.full.map((step) => step.el));
      expect(inGuide.size, guide.section).toBe(guide.full.length);
      for (const step of guide.full) {
        const element = UI_MAP_BY_KEY.get(step.el);
        expect(element, `${guide.section}: ${step.el}`).toBeDefined();
        expect(element!.prefix, step.el).toBeFalsy();
        if (step.act === "do") {
          for (const [locale, messages] of [["cs", cs], ["en", en]] as const) {
            expect(lookup(messages as Messages, `tutorial.ui.${step.el}.try`), `${locale} ${step.el}.try`).toBeTruthy();
          }
        }
      }
      const ofSection = UI_MAP.filter((element) => element.section === guide.section && !element.prefix);
      const left = ofSection.filter((element) => !inGuide.has(element.key)).map((element) => element.key);
      // An element that exists only on a phone may stay out of the full guide (a desktop has nothing to show).
      expect(left.filter((key) => key !== "deal-tabs"), guide.section).toEqual([]);
    }
  });
});
