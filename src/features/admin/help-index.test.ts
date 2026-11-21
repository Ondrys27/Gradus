import { describe, expect, it } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { ADMIN_HELP, helpFor, helpItemHref, matchesSearch, normalizeSearch } from "./help-index";
import { ADMIN_SECTIONS } from "./nav";

type Help = { sections: Record<string, string>; items: Record<string, { title: string; keywords: string }> };
const help = (messages: unknown) => (messages as { admin: { help: Help } }).admin.help;

describe("the help index", () => {
  it("has every section of the menu, and nothing else", () => {
    expect(Object.keys(ADMIN_HELP).sort()).toEqual(ADMIN_SECTIONS.map((section) => section.key).sort());
    for (const section of ADMIN_SECTIONS) {
      expect(ADMIN_HELP[section.key].length, section.key).toBeGreaterThan(0);
    }
  });

  it("has the texts of every section and item in both languages", () => {
    const keys = new Set<string>();
    for (const [section, items] of Object.entries(ADMIN_HELP)) {
      for (const messages of [cs, en]) {
        expect(help(messages).sections[section], section).toBeTruthy();
        for (const item of items) {
          expect(help(messages).items[item.key]?.title, item.key).toBeTruthy();
          expect(help(messages).items[item.key]?.keywords, item.key).toBeTruthy();
        }
      }
      for (const item of items) {
        expect(keys.has(item.key), `${item.key} twice`).toBe(false);
        keys.add(item.key);
      }
    }
  });

  it("points every item into its own section", () => {
    for (const section of ADMIN_SECTIONS) {
      for (const item of ADMIN_HELP[section.key]) {
        expect(item.href.split("?")[0], item.key).toBe(section.href);
      }
    }
  });

  it("shows each actor only what they may see and use", () => {
    const owner = helpFor({ role: "owner", level: "full" });
    const full = helpFor({ role: "admin", level: "full" });
    const limited = helpFor({ role: "admin", level: "limited" });
    expect(owner.some((section) => section.key === "admins")).toBe(true);
    expect(full.some((section) => section.key === "admins")).toBe(false);
    const items = (sections: typeof owner) => sections.flatMap((section) => section.items.map((item) => item.key));
    expect(items(full)).toEqual(expect.arrayContaining(["plansPublish", "emailChange", "usersExport"]));
    expect(items(limited)).not.toEqual(expect.arrayContaining(["plansPublish"]));
    expect(items(limited)).toEqual(expect.arrayContaining(["aiCaps", "plansHistory", "passwordReset"]));
    expect(items(limited)).not.toContain("emailChange");
  });
});

describe("searching", () => {
  it("ignores case, diacritics and extra spaces", () => {
    expect(normalizeSearch("  Strop   využití AI ")).toBe("strop vyuziti ai");
    expect(matchesSearch("Strop využití AI · AI a Grady", "strop ai")).toBe(true);
    expect(matchesSearch("Reset hesla", "reset hes")).toBe(true);
    expect(matchesSearch("Zveřejnit tarify", "zverejnit")).toBe(true);
    expect(matchesSearch("Promo kód", "kod promo")).toBe(true);
    expect(matchesSearch("Promo kód", "tarif")).toBe(false);
    expect(matchesSearch("Cokoli", "")).toBe(true);
  });
});

describe("finding a setting the way ⌘K does", () => {
  /** The items an owner's ⌘K lists for a query, as in admin-nav.tsx: title, keywords and the section's name. */
  function find(messages: unknown, query: string): string[] {
    const texts = help(messages);
    return helpFor({ role: "owner", level: "full" }).flatMap((section) =>
      section.items
        .filter((item) => {
          const own = texts.items[item.key]!;
          return matchesSearch(`${own.title} ${own.keywords}`, query);
        })
        .map((item) => item.key),
    );
  }

  it("finds the examples of the plan in Czech and in English", () => {
    expect(find(cs, "strop AI")).toContain("aiCaps");
    expect(find(cs, "promo kód")).toContain("promoCreate");
    expect(find(cs, "reset hesla")).toContain("passwordReset");
    expect(find(cs, "zveřejnit tarify")).toContain("plansPublish");
    expect(find(en, "ai cap")).toContain("aiCaps");
    expect(find(en, "password reset")).toContain("passwordReset");
    expect(find(en, "publish plans")).toContain("plansPublish");
  });
});

describe("helpItemHref", () => {
  it("keeps the shared view and the anchor", () => {
    expect(helpItemHref({ href: "/admin/ai", anchor: "stropy" }, "?period=7d")).toBe("/admin/ai?period=7d#stropy");
    expect(helpItemHref({ href: "/admin/ai?tab=rules", anchor: "grady-rules" }, "?period=7d")).toBe(
      "/admin/ai?tab=rules&period=7d#grady-rules",
    );
    expect(helpItemHref({ href: "/admin/tarify" }, "")).toBe("/admin/tarify");
  });
});
