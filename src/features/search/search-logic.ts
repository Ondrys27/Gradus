/**
 * Pure logic of the global search (⌘K): the parameters sent to
 * `global_search()`, matching of the app's own pages and actions, highlighting,
 * keyboard movement across groups and the recent lists.
 */
import { cleanTerm, phoneSearchDigits } from "@/features/contacts/contact-search";
import type { ContactDraft } from "@/features/contacts/schemas";

/** Result kinds that live in the database, in their default order. */
export const DB_KINDS = [
  "contact",
  "deal",
  "milestone",
  "task",
  "event",
  "transaction",
  "invoice",
  "worker",
] as const;
export type DbKind = (typeof DB_KINDS)[number];

/** Result kinds from the app itself, matched in the browser. */
export const LOCAL_KINDS = ["action", "section", "setting"] as const;
export type LocalKind = (typeof LOCAL_KINDS)[number];

export type ResultKind = DbKind | LocalKind;

/** Rows shown per group; one more is asked for, to know whether "Show all" has more. */
export const GROUP_SIZE = 5;
/** Rows of one kind after "Show all". */
export const ALL_SIZE = 50;
/** Recent searches and recently opened results kept in user_settings. */
export const RECENT_MAX = 8;
/** The database is asked from this many characters on (a phone part needs three digits). */
export const MIN_DB_QUERY = 2;

/** Lower case without diacritics: "Novák" → "novak". Mirrors `search_norm()` in the database. */
export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The query as the database gets it: single spaces, trimmed. */
export function tidyQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

/**
 * A typed amount as a number, or null: "150000", "150 000", "1 200,50",
 * "1,200.50", "30.000". Anything with letters is not an amount.
 */
export function parseAmount(query: string): number | null {
  const compact = query.replace(/[\s  ]/g, "");
  if (!/^\d[\d.,]*$/.test(compact)) return null;
  let normalized: string;
  if (/^\d{1,3}([.,]\d{3})+$/.test(compact)) {
    normalized = compact.replace(/[.,]/g, "");
  } else if (/^\d+([.,]\d{1,2})?$/.test(compact)) {
    normalized = compact.replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})*\.\d{1,2}$/.test(compact)) {
    normalized = compact.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(compact)) {
    normalized = compact.replace(/\./g, "").replace(",", ".");
  } else {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export type SearchRpcArgs = {
  _query: string;
  _phone_patterns: string[];
  _amount: number | null;
  _kinds: DbKind[] | null;
  _limit: number;
};

/**
 * Arguments of `global_search()`. Phone numbers are matched by their digits,
 * so "777 123" and "+420 777 123 456" find the same contact; a number-like
 * query also looks for deals of that value.
 */
export function searchParams(query: string, kinds?: readonly string[]): SearchRpcArgs {
  const tidy = tidyQuery(query).slice(0, 100);
  const only = kinds?.filter((kind): kind is DbKind =>
    (DB_KINDS as readonly string[]).includes(kind),
  );
  return {
    _query: tidy,
    _phone_patterns: phoneSearchDigits(cleanTerm(tidy)),
    _amount: parseAmount(tidy),
    _kinds: only && only.length > 0 ? only : null,
    _limit: only && only.length === 1 ? ALL_SIZE : GROUP_SIZE + 1,
  };
}

/** Whether the query is worth a database round trip. */
export function shouldQueryDatabase(query: string): boolean {
  return tidyQuery(query).length >= MIN_DB_QUERY;
}

// ---------------------------------------------------------------------------
// Matching of the app's own sections, settings and actions
// ---------------------------------------------------------------------------

function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}

/** How well one typed word fits one word of the entry: 0 means not at all. */
export function wordScore(token: string, word: string): number {
  if (!token || !word) return 0;
  if (word === token) return 3;
  if (word.startsWith(token)) return 2.5;
  if (word.includes(token)) return 1.5;
  // A typo or a different ending ("meny" for "mena"), for words long enough to tell.
  if (token.length >= 4) {
    const stem = word.slice(0, token.length);
    if (editDistanceWithin(token, stem, 1) || editDistanceWithin(token, word, 1)) return 1;
  }
  return 0;
}

/**
 * Score of an entry for the query: every typed word must fit some word of the
 * label or its keywords; the label counts more. 0 when it does not match.
 */
export function localScore(query: string, label: string, keywords = ""): number {
  const tokens = normalizeText(tidyQuery(query)).split(" ").filter(Boolean);
  if (tokens.length === 0) return 0;
  const labelWords = normalizeText(label)
    .split(/[\s/,.–-]+/)
    .filter(Boolean);
  const keywordWords = normalizeText(keywords)
    .split(/[\s/,.–-]+/)
    .filter(Boolean);
  let total = 0;
  for (const token of tokens) {
    const inLabel = Math.max(0, ...labelWords.map((word) => wordScore(token, word)));
    const inKeywords = Math.max(0, ...keywordWords.map((word) => wordScore(token, word))) * 0.8;
    const best = Math.max(inLabel, inKeywords);
    if (best === 0) return 0;
    total += best;
  }
  return total / tokens.length;
}

// ---------------------------------------------------------------------------
// Highlighting
// ---------------------------------------------------------------------------

export type Segment = { text: string; match: boolean };

/**
 * The text cut into matched and plain parts, comparing without diacritics and
 * case: "novak" marks "Novák" in "Jan Novák". Each typed word is marked.
 */
export function highlight(text: string, query: string): Segment[] {
  if (!text) return [];
  // Normalized characters with the index of the original character they come from.
  let normalized = "";
  const origin: number[] = [];
  Array.from(text).reduce((offset, char) => {
    const plain = normalizeText(char);
    normalized += plain;
    for (let unit = 0; unit < plain.length; unit++) origin.push(offset);
    return offset + char.length;
  }, 0);

  const marked = new Array<boolean>(text.length).fill(false);
  const tokens = normalizeText(tidyQuery(query)).split(" ").filter(Boolean);
  for (const token of tokens) {
    let from = normalized.indexOf(token);
    while (from !== -1) {
      const start = origin[from];
      const lastOrigin = origin[from + token.length - 1];
      const end = lastOrigin + (text.codePointAt(lastOrigin)! > 0xffff ? 2 : 1);
      for (let i = start; i < end; i++) marked[i] = true;
      from = normalized.indexOf(token, from + token.length);
    }
  }

  const segments: Segment[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = segments[segments.length - 1];
    if (last && last.match === marked[i]) last.text += text[i];
    else segments.push({ text: text[i], match: marked[i] });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Groups and keyboard movement
// ---------------------------------------------------------------------------

/** Groups with their best match first; empty ones drop out and ties keep the given order. */
export function orderGroups<G extends { items: { rank: number }[] }>(groups: G[]): G[] {
  return groups
    .filter((group) => group.items.length > 0)
    .map((group, index) => ({ group, index, best: Math.max(...group.items.map((i) => i.rank)) }))
    .sort((a, b) => b.best - a.best || a.index - b.index)
    .map(({ group }) => group);
}

/** Arrow keys: the next or previous row across all groups, wrapping around. */
export function moveSelection(index: number, total: number, step: 1 | -1): number {
  if (total === 0) return 0;
  return (index + step + total) % total;
}

/** Tab: the first row of the next (or previous) group, wrapping around. */
export function jumpGroup(index: number, sizes: number[], step: 1 | -1): number {
  const starts: number[] = [];
  sizes.reduce((start, size) => {
    starts.push(start);
    return start + size;
  }, 0);
  if (starts.length === 0) return 0;
  let current = 0;
  for (let g = 0; g < starts.length; g++) if (index >= starts[g]) current = g;
  const next = (current + step + starts.length) % starts.length;
  return starts[next];
}

// ---------------------------------------------------------------------------
// Recent lists
// ---------------------------------------------------------------------------

export type RecentItem = {
  kind: ResultKind;
  id: string;
  title: string;
  href: string;
};

/** Only links inside the app are followed from what is stored. */
export function isSafeHref(href: unknown): href is string {
  return typeof href === "string" && /^\/[a-z]/i.test(href) && !href.startsWith("//");
}

/** The stored list read defensively: anything malformed is dropped. */
export function readRecentItems(value: unknown): RecentItem[] {
  if (!Array.isArray(value)) return [];
  const kinds: readonly string[] = [...DB_KINDS, ...LOCAL_KINDS];
  return value
    .filter(
      (item): item is RecentItem =>
        typeof item === "object" &&
        item !== null &&
        kinds.includes((item as RecentItem).kind) &&
        typeof (item as RecentItem).id === "string" &&
        typeof (item as RecentItem).title === "string" &&
        isSafeHref((item as RecentItem).href),
    )
    .slice(0, RECENT_MAX);
}

/** A newly opened result goes first; an older copy of it and anything past eight drop out. */
export function pushRecentItem(list: RecentItem[], item: RecentItem): RecentItem[] {
  const clean: RecentItem = {
    kind: item.kind,
    id: item.id,
    title: item.title.slice(0, 120),
    href: item.href,
  };
  return [clean, ...list.filter((i) => !(i.kind === item.kind && i.id === item.id))].slice(
    0,
    RECENT_MAX,
  );
}

/** A search the user acted on goes first, case- and accent-insensitively unique. */
export function pushRecentSearch(list: string[], query: string): string[] {
  const tidy = tidyQuery(query).slice(0, 100);
  if (!tidy) return list.slice(0, RECENT_MAX);
  const key = normalizeText(tidy);
  return [tidy, ...list.filter((q) => normalizeText(q) !== key)].slice(0, RECENT_MAX);
}

// ---------------------------------------------------------------------------
// "Create contact …" from the typed text
// ---------------------------------------------------------------------------

const COMPANY_MARKERS =
  /\b(s\.?\s?r\.?\s?o|a\.?\s?s|spol|v\.?\s?o\.?\s?s|k\.?\s?s|z\.?\s?s|ltd|inc|llc|gmbh|corp)\b\.?/i;

/**
 * What a new contact starts with when created from the search: an e-mail, a
 * phone number, a person ("Jan Novák") or otherwise a company name.
 */
export function contactDraftFromText(text: string): Partial<ContactDraft> {
  const tidy = tidyQuery(text).slice(0, 120);
  if (!tidy) return {};
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tidy)) return { email: tidy };
  if (!/\p{L}/u.test(tidy) && tidy.replace(/\D/g, "").length >= 6) return { phone: tidy };
  const words = tidy.split(" ");
  const personLike =
    words.length >= 2 &&
    words.length <= 3 &&
    !COMPANY_MARKERS.test(tidy) &&
    words.every((word) => /^\p{Lu}[\p{L}'’-]*$/u.test(word));
  if (personLike) return { first_name: words[0], last_name: words.slice(1).join(" ") };
  return { company_name: tidy };
}
