/**
 * The words of a question to Grady's guide (30.8), without React: how a
 * question is normalised (one cache entry for "Jak přidám úkol?" and
 * "jak pridam ukol"), whether it is a "how do I…" question (⌘K and the chat
 * offer to show it on screen), the anonymous text kept for the
 * administration and the words it is searched by.
 */

export const QUESTION_MAX = 300;

/** Lower case, no diacritics, no punctuation, single spaces. */
export function normalizeQuestion(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, QUESTION_MAX);
}

const HOW_START = /^(jak|kde|kudy|co mam udelat|muzu|lze|da se|how|where|can i|is there a way)\b/;

/** A question about doing something in the app: starts "jak…", "kde…", "how…", "where…". */
export function isHowQuestion(text: string): boolean {
  const normal = normalizeQuestion(text);
  return normal.length >= 6 && HOW_START.test(normal);
}

/** Words too common to tell controls apart (both languages, normalised). */
const STOP_WORDS = new Set(
  (
    "a i k o s u v z na do je se si to ta ten ty mi me mu za ze po pod nad pri pro jak kde co kdo kdy " +
    "mam muzu chci chtel bych by aby ale nebo tak uz jeste tady tam svuj svoje sve moje muj jsem jsi " +
    "the a an to of in on at for is are do does i my me how can where what which with and or it this " +
    "that be from into there way want would like please"
  ).split(" "),
);

/** The words a question is matched by: no stop words, at least 3 letters, a crude stem. */
export function questionWords(text: string): string[] {
  const words = normalizeQuestion(text)
    .split(" ")
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
    .map(stem);
  return [...new Set(words)];
}

/**
 * A rough stem good enough to match "úkolu", "úkoly", "úkol" or "tasks",
 * "task": the first five letters of a longer word, a trailing English "s" off.
 */
export function stem(word: string): string {
  const english = word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
  return english.length > 5 ? english.slice(0, 5) : english;
}

/**
 * The question as the administration sees it ("what people ask about"):
 * no account, and nothing that looks like contact data or a number. E-mails,
 * links, phone numbers and other digits become "…".
 */
export function anonymousQuestion(text: string): string {
  return text
    .replace(/\S+@\S+/g, "…")
    .replace(/\bhttps?:\/\/\S+/gi, "…")
    .replace(/\+?\d[\d\s/-]{2,}\d/g, "…")
    .replace(/\d+/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
