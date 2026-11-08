/**
 * Pure checks of docs/funkce.md against the code, shared by `bun run
 * docs:funkce` and its Vitest. The document marks what it covers with hidden
 * comments a reader of the rendered page does not see:
 *
 *   <!-- kód: nav:pipeline route:/app/pipeline -->
 *   <!-- cena: ai=chat in=3500 read=2500 write=0 out=450 -->
 *
 * A `kód` comment lists code keys (prefix:value) the text around it
 * describes. A `cena` comment sits on one row of the Jarvis table: the model
 * job and its typical tokens, from which the price shown on the same row is
 * recomputed with the prices of src/config/costs.ts.
 */

/** One thing the code has that the document should describe. */
export type ExpectedKey = { key: string; source: string };

export type TokenUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

const CODE_COMMENT = /<!--\s*kód:([\s\S]*?)-->/g;
const KEY = /^[a-z][a-zA-Z-]*:\S+$/;

/** Every key of the `kód` comments of the document. */
export function docKeys(markdown: string): Set<string> {
  const keys = new Set<string>();
  for (const match of markdown.matchAll(CODE_COMMENT)) {
    for (const word of match[1].split(/\s+/)) if (KEY.test(word)) keys.add(word);
  }
  return keys;
}

/** What the code has and the document does not mention, in the order of `expected`. */
export function missingKeys(expected: readonly ExpectedKey[], keys: Set<string>): ExpectedKey[] {
  return expected.filter((item) => !keys.has(item.key));
}

/**
 * Keys of the document with a prefix the code is checked for, but which the
 * code no longer has: a removed or renamed feature still described.
 */
export function staleKeys(expected: readonly ExpectedKey[], keys: Set<string>): string[] {
  const known = new Set(expected.map((item) => item.key));
  const prefixes = new Set(expected.map((item) => item.key.split(":")[0]));
  return [...keys].filter((key) => prefixes.has(key.split(":")[0]) && !known.has(key)).sort();
}

/**
 * The page address of a Next.js page file, relative to src/app: route groups
 * "(name)" and the file name dropped. "(app)/app/milniky/[id]/page.tsx" →
 * "/app/milniky/[id]"; "(marketing)/(cs)/page.tsx" → "/".
 */
export function routeOf(pageFile: string): string {
  const segments = pageFile
    .split(/[\\/]/)
    .slice(0, -1)
    .filter((segment) => segment && !(segment.startsWith("(") && segment.endsWith(")")));
  return `/${segments.join("/")}`;
}

/** The `kind`s the Jarvis route answers to, from its source (`kind === "…"`). */
export function routeKinds(source: string): string[] {
  const kinds = new Set<string>();
  for (const match of source.matchAll(/\bkind === "([a-zA-Z]+)"/g)) kinds.add(match[1]);
  return [...kinds];
}

export type PricedRow = {
  /** 1-based line of the document. */
  line: number;
  feature: string;
  usage: TokenUsage;
  /** The price shown on the row in USD, null when the row has none. */
  shownUsd: number | null;
  /** Decimals the shown price is written with. */
  shownDecimals: number;
};

const PRICE_COMMENT = /<!--\s*cena:([^>]*?\bai=[^>]*?)-->/;
const SHOWN_PRICE = /(\d+(?:[.,]\d+)?)\s*USD/;

function numberField(fields: Map<string, string>, name: string): number {
  const value = Number(fields.get(name) ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
}

/** The rows carrying a `cena` comment, in the document's order. */
export function pricedRows(markdown: string): PricedRow[] {
  const rows: PricedRow[] = [];
  markdown.split("\n").forEach((text, index) => {
    const comment = text.match(PRICE_COMMENT);
    if (!comment) return;
    const fields = new Map(
      comment[1]
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split("=") as [string, string]),
    );
    const visible = text.replace(PRICE_COMMENT, "");
    const shown = visible.match(SHOWN_PRICE);
    const raw = shown?.[1].replace(",", ".") ?? null;
    rows.push({
      line: index + 1,
      feature: fields.get("ai") ?? "",
      usage: {
        inputTokens: numberField(fields, "in"),
        cacheReadTokens: numberField(fields, "read"),
        cacheWriteTokens: numberField(fields, "write"),
        outputTokens: numberField(fields, "out"),
      },
      shownUsd: raw === null ? null : Number(raw),
      shownDecimals: raw?.includes(".") ? raw.split(".")[1].length : 0,
    });
  });
  return rows;
}

export type PriceTools = {
  features: readonly string[];
  /** Price of one call of the feature with these tokens, in USD. */
  price: (feature: string, usage: TokenUsage) => number;
};

/**
 * What is wrong with the priced rows: an unknown job, a price that does not
 * match the tokens (rounded to the decimals it is written with), or rows not
 * ordered from the most expensive.
 */
export function priceIssues(rows: readonly PricedRow[], tools: PriceTools): string[] {
  const issues: string[] = [];
  let previous: { line: number; usd: number } | null = null;
  for (const row of rows) {
    const where = `docs/funkce.md:${row.line}`;
    if (!tools.features.includes(row.feature)) {
      issues.push(`${where}: unknown AI job "${row.feature}"`);
      continue;
    }
    if (Object.values(row.usage).some((value) => Number.isNaN(value))) {
      issues.push(`${where}: unreadable token counts`);
      continue;
    }
    const usd = tools.price(row.feature, row.usage);
    if (row.shownUsd === null) {
      issues.push(`${where}: no price in USD on the row (tokens give ${usd.toFixed(4)} USD)`);
    } else {
      const factor = 10 ** row.shownDecimals;
      const expected = Math.round(usd * factor) / factor;
      if (Math.abs(expected - row.shownUsd) > 1e-9) {
        issues.push(
          `${where}: shows ${row.shownUsd} USD, the tokens give ${expected.toFixed(row.shownDecimals)} USD`,
        );
      }
    }
    if (previous && usd > previous.usd + 1e-9) {
      issues.push(`${where}: costs more than the row above (line ${previous.line}); sort from the most expensive`);
    }
    previous = { line: row.line, usd };
  }
  return issues;
}
