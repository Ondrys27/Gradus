import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { ALL_CATEGORIES } from "../types";

/**
 * Category key → its names in every language of the app. A transaction finds
 * its plan row by category whatever language the row was named in, and the
 * answer does not change when the user switches the language. Server only
 * (the finance page passes the result down): the dictionaries must never be
 * bundled for the browser.
 */
export function categoryNames(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const key of ALL_CATEGORIES) {
    const names = [cs.finance.categories, en.finance.categories]
      .map((dictionary) => (dictionary as Record<string, string>)[key])
      .filter((name): name is string => Boolean(name));
    result[key] = names;
  }
  return result;
}
