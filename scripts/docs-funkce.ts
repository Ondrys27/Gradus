/**
 * Compares docs/funkce.md (what Gradus and Grady can do and what it costs)
 * with the code and prints what the document is missing: pages of the route
 * groups, sidebar sections, Grady's catalogs and plan limits it does not
 * mention, keys it still mentions that the code no longer has, and Grady
 * prices that no longer match the tokens and src/config/costs.ts. Exits with
 * 1 when anything is off. How the document marks what it covers is in
 * scripts/docs-funkce/check.ts.
 *
 *   bun run docs:funkce
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { docKeys, missingKeys, priceIssues, pricedRows, staleKeys } from "./docs-funkce/check";
import { expectedKeys, PRICE_TOOLS } from "./docs-funkce/sources";

const ROOT = process.cwd();
const DOC = path.join(ROOT, "docs/funkce.md");

const markdown = readFileSync(DOC, "utf8");
const expected = expectedKeys(ROOT);
const keys = docKeys(markdown);
const missing = missingKeys(expected, keys);
const stale = staleKeys(expected, keys);
const prices = priceIssues(pricedRows(markdown), PRICE_TOOLS);

if (missing.length) {
  console.log(`Missing in docs/funkce.md (${missing.length}):`);
  for (const item of missing) console.log(`  ${item.key}  (${item.source})`);
}
if (stale.length) {
  console.log(`In docs/funkce.md but no longer in the code (${stale.length}):`);
  for (const key of stale) console.log(`  ${key}`);
}
if (prices.length) {
  console.log(`Grady prices (${prices.length}):`);
  for (const issue of prices) console.log(`  ${issue}`);
}

if (missing.length || stale.length || prices.length) {
  console.log(
    "\nAdd a sentence for each missing item to docs/funkce.md with its key in a hidden " +
      "<!-- kód: … --> comment, drop what is gone, and fix the prices.",
  );
  process.exit(1);
}
console.log(`docs/funkce.md covers all ${expected.length} items of the code; prices match.`);
