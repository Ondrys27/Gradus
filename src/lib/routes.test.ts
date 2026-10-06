import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prefersEnglish } from "./site-locale";
import {
  LEGACY_REDIRECTS,
  legacyRedirectTarget,
  localizedPath,
  pageForPath,
  switchLocalePath,
} from "./routes";

describe("localized pages", () => {
  it("finds the page and language of an address", () => {
    expect(pageForPath("/")).toEqual({ page: "home", locale: "cs" });
    expect(pageForPath("/en")).toEqual({ page: "home", locale: "en" });
    expect(pageForPath("/en/pricing/")).toEqual({ page: "pricing", locale: "en" });
    expect(pageForPath("/app")).toBeNull();
  });

  it("switches language on the same page", () => {
    expect(switchLocalePath("/cenik", "en")).toBe("/en/pricing");
    expect(switchLocalePath("/en/login", "cs")).toBe("/prihlaseni");
    expect(switchLocalePath("/app", "en")).toBeNull();
    expect(localizedPath("register", "de")).toBe("/registrace");
  });
});

describe("legacy redirects", () => {
  it("moves old app addresses under /app, keeping the rest of the path", () => {
    expect(legacyRedirectTarget("/dashboard")).toBe("/app");
    expect(legacyRedirectTarget("/milestones/42")).toBe("/app/milniky/42");
    expect(legacyRedirectTarget("/contacts/tables")).toBe("/app/kontakty/tabulky");
    expect(legacyRedirectTarget("/workers/rewards")).toBe("/app/pracovnici/odmeny");
    expect(legacyRedirectTarget("/register")).toBe("/en/register");
    expect(legacyRedirectTarget("/milestonesx")).toBeNull();
  });

  it("lists every more specific address before its parent", () => {
    LEGACY_REDIRECTS.forEach(([from], index) => {
      const parent = LEGACY_REDIRECTS.findIndex(
        ([other], i) => i !== index && from.startsWith(`${other}/`),
      );
      if (parent !== -1) expect(parent).toBeGreaterThan(index);
    });
  });

  it("leaves no link in the source pointing at an old address", () => {
    const old = LEGACY_REDIRECTS.map(([from]) => from.replace(/[-/]/g, "\\$&")).join("|");
    const pattern = new RegExp(`["'\`](${old})(?=["'\`/?#])`);
    const root = path.resolve(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          if (full.endsWith(path.join("lib", "routes.ts"))) continue;
          if (pattern.test(readFileSync(full, "utf8"))) offenders.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe("prefersEnglish", () => {
  it("reads the browser's ranked languages", () => {
    expect(prefersEnglish("cs-CZ,cs;q=0.9,en;q=0.8")).toBe(false);
    expect(prefersEnglish("en-US,en;q=0.9,cs;q=0.8")).toBe(true);
    expect(prefersEnglish("sk-SK,sk;q=0.9")).toBe(false);
    expect(prefersEnglish("de-DE,de;q=0.9")).toBe(true);
    expect(prefersEnglish("cs;q=0.5,en;q=0.9")).toBe(true);
    expect(prefersEnglish(null)).toBe(false);
  });
});
