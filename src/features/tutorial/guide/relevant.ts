import type { GuideSection, UiElement } from "../ui-map/types";
import { questionWords } from "./question";

/**
 * The part of the catalog a question is about (30.8): the model reads only
 * these elements, never the whole catalog. An element scores by the words
 * of the question found in its name, purpose and keywords (both languages,
 * stemmed), a little more in the section the person is in; what has to be
 * opened before a found element comes along. Without any match the elements
 * of the current section stand in, so a vague question still has something
 * to point at.
 */

export const RELEVANT_LIMIT = 30;
const FALLBACK_LIMIT = 16;

export type ElementWords = (element: UiElement) => string;

function wordsOf(text: string): Set<string> {
  return new Set(questionWords(text));
}

export function relevantElements(input: {
  question: string;
  section: GuideSection | null;
  elements: readonly UiElement[];
  /** Name, purpose and keywords of an element, in every language. */
  textOf: ElementWords;
  limit?: number;
}): UiElement[] {
  const limit = input.limit ?? RELEVANT_LIMIT;
  const asked = questionWords(input.question);
  const candidates = input.elements.filter((element) => !element.prefix);
  const byKey = new Map(candidates.map((element) => [element.key, element]));

  const scored = candidates
    .map((element, order) => {
      const words = wordsOf(input.textOf(element));
      let score = 0;
      for (const word of asked) if (words.has(word)) score += 2;
      if (score > 0 && element.section === input.section) score += 1;
      return { element, score, order };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);

  const picked: UiElement[] = [];
  const add = (element: UiElement | undefined) => {
    if (!element || picked.includes(element) || picked.length >= limit) return;
    picked.push(element);
  };
  for (const { element } of scored) {
    for (const key of element.via ?? []) add(byKey.get(key));
    add(element);
  }
  if (picked.length === 0 && input.section) {
    for (const element of candidates.filter((entry) => entry.section === input.section).slice(0, FALLBACK_LIMIT)) {
      add(element);
    }
  }
  return picked;
}
