import cs from "../../../src/locales/cs.json";
import en from "../../../src/locales/en.json";

export type Locale = "cs" | "en";

const messages: Record<Locale, unknown> = { cs, en };
const APP_NAME = "Gradus";

/**
 * A text of the app in one language, by its key, so the tests follow the
 * translations instead of copying them. Plain `{name}` placeholders are filled
 * in; ICU plural and select blocks are not supported (pick a plain key).
 */
export function text(locale: Locale, key: string, values: Record<string, string | number> = {}) {
  let node: unknown = messages[locale];
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in node) {
      node = (node as Record<string, unknown>)[part];
    } else {
      throw new Error(`Missing ${locale} text: ${key}`);
    }
  }
  if (typeof node !== "string") throw new Error(`Not a text: ${key}`);
  const all: Record<string, string | number> = { appName: APP_NAME, ...values };
  return node.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in all ? String(all[name]) : match,
  );
}

/** The same text as a regular expression, matched exactly (for accessible names). */
export function exact(locale: Locale, key: string, values?: Record<string, string | number>) {
  return new RegExp(`^${escape(text(locale, key, values))}$`);
}

/** The text as a regular expression matched anywhere. */
export function within(locale: Locale, key: string, values?: Record<string, string | number>) {
  return new RegExp(escape(text(locale, key, values)));
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
