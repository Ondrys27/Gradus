/**
 * The ⌘K palette lists every sidebar section by `nav.<key>` and matches it by
 * the keywords in `search.sections.<key>`. Those keys are built at runtime, so
 * the static translation check cannot see them: a new menu item without them
 * only shows up as MISSING_MESSAGE in the browser.
 */
import { describe, expect, it } from "vitest";
import { navItems, workerOnlyItems } from "@/components/layout/nav-items";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";

type Messages = { [key: string]: string | Messages };

function lookup(messages: Messages, keyPath: string): unknown {
  let node: unknown = messages;
  for (const part of keyPath.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Messages)[part];
  }
  return node;
}

const LOCALES = { en: en as Messages, cs: cs as Messages };
const KEYS = [...navItems, ...workerOnlyItems].map((item) => item.key);

describe("menu items in the search palette", () => {
  for (const [locale, messages] of Object.entries(LOCALES)) {
    it.each(KEYS)(`${locale}: has a label and search keywords for %s`, (key) => {
      const label = lookup(messages, `nav.${key}`);
      const keywords = lookup(messages, `search.sections.${key}`);
      expect(typeof label, `nav.${key}`).toBe("string");
      expect(typeof keywords, `search.sections.${key}`).toBe("string");
      expect((keywords as string).trim()).not.toBe("");
    });
  }
});
