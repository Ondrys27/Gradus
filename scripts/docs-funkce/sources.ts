/**
 * What the code has that docs/funkce.md should describe: the pages of the
 * route groups, the sidebar sections, Grady's catalogs (model jobs, route
 * kinds, proactive types, chat chips, questions, frequencies) and the plan
 * limits. Read from the modules themselves where they are plain data, from
 * the file system for the pages and the route's source for its kinds.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { navItems, workerOnlyItems } from "@/components/layout/nav-items";
import { PLAN_LIMIT_KEYS } from "@/config/pricing";
import { costUsd, GRADY_FEATURES, modelFor, type GradyFeature } from "@/features/grady/models";
import { GRADY_FREQUENCIES, PROACTIVE_SUGGESTION_TYPES } from "@/features/grady/proactive";
import { SUGGESTION_KEYS } from "@/features/grady/protocol";
import { GRADY_QUESTIONS } from "@/features/grady/questions";
import { RULE_TYPES } from "@/features/grady/suggestion-types";
import { routeKinds, routeOf, type ExpectedKey, type PriceTools } from "./check";

/** Route groups whose pages the document covers (the administration is ours, not a feature). */
export const ROUTE_GROUPS = ["(app)", "(auth)", "(marketing)"] as const;

function pageFiles(dir: string, base: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...pageFiles(full, base));
    else if (entry.name === "page.tsx") files.push(path.relative(base, full));
  }
  return files;
}

export function expectedKeys(root: string): ExpectedKey[] {
  const appDir = path.join(root, "src/app");
  const keys: ExpectedKey[] = [];
  const add = (key: string, source: string) => {
    if (!keys.some((item) => item.key === key)) keys.push({ key, source });
  };

  for (const item of [...navItems, ...workerOnlyItems]) {
    add(`nav:${item.key}`, "src/components/layout/nav-items.ts");
  }
  for (const group of ROUTE_GROUPS) {
    for (const file of pageFiles(path.join(appDir, group), appDir).sort()) {
      add(`route:${routeOf(file)}`, `src/app/${file}`);
    }
  }
  for (const feature of GRADY_FEATURES) add(`ai:${feature}`, "src/features/grady/models.ts");
  const route = readFileSync(path.join(appDir, "api/grady/route.ts"), "utf8");
  for (const kind of routeKinds(route)) add(`kind:${kind}`, "src/app/api/grady/route.ts");
  for (const type of [...RULE_TYPES, ...PROACTIVE_SUGGESTION_TYPES]) {
    add(`proactive:${type}`, "src/features/grady/proactive.ts, suggestion-types.ts");
  }
  for (const chip of SUGGESTION_KEYS) add(`chip:${chip}`, "src/features/grady/protocol.ts");
  for (const question of GRADY_QUESTIONS) {
    add(`question:${question.key}`, "src/features/grady/questions.ts");
  }
  for (const frequency of GRADY_FREQUENCIES) {
    add(`frequency:${frequency}`, "src/features/grady/proactive.ts");
  }
  for (const limit of PLAN_LIMIT_KEYS) add(`limit:${limit}`, "src/config/pricing.ts");
  return keys;
}

/** Prices of the Grady table: the model each job is routed to, priced with src/config/costs.ts. */
export const PRICE_TOOLS: PriceTools = {
  features: GRADY_FEATURES,
  price: (feature, usage) => costUsd(modelFor(feature as GradyFeature), usage),
};
