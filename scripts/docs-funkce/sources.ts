/**
 * What the code has that docs/funkce.md should describe: the pages of the
 * route groups, the sidebar sections, Jarvis's catalogs (model jobs, route
 * kinds, proactive types, chat chips, questions, frequencies) and the plan
 * limits. Read from the modules themselves where they are plain data, from
 * the file system for the pages and the route's source for its kinds.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { navItems, workerOnlyItems } from "@/components/layout/nav-items";
import { PLAN_LIMIT_KEYS } from "@/config/pricing";
import { costUsd, JARVIS_FEATURES, modelFor, type JarvisFeature } from "@/features/jarvis/models";
import { JARVIS_FREQUENCIES, PROACTIVE_SUGGESTION_TYPES } from "@/features/jarvis/proactive";
import { SUGGESTION_KEYS } from "@/features/jarvis/protocol";
import { JARVIS_QUESTIONS } from "@/features/jarvis/questions";
import { RULE_TYPES } from "@/features/jarvis/suggestion-types";
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
  for (const feature of JARVIS_FEATURES) add(`ai:${feature}`, "src/features/jarvis/models.ts");
  const route = readFileSync(path.join(appDir, "api/jarvis/route.ts"), "utf8");
  for (const kind of routeKinds(route)) add(`kind:${kind}`, "src/app/api/jarvis/route.ts");
  for (const type of [...RULE_TYPES, ...PROACTIVE_SUGGESTION_TYPES]) {
    add(`proactive:${type}`, "src/features/jarvis/proactive.ts, suggestion-types.ts");
  }
  for (const chip of SUGGESTION_KEYS) add(`chip:${chip}`, "src/features/jarvis/protocol.ts");
  for (const question of JARVIS_QUESTIONS) {
    add(`question:${question.key}`, "src/features/jarvis/questions.ts");
  }
  for (const frequency of JARVIS_FREQUENCIES) {
    add(`frequency:${frequency}`, "src/features/jarvis/proactive.ts");
  }
  for (const limit of PLAN_LIMIT_KEYS) add(`limit:${limit}`, "src/config/pricing.ts");
  return keys;
}

/** Prices of the Jarvis table: the model each job is routed to, priced with src/config/costs.ts. */
export const PRICE_TOOLS: PriceTools = {
  features: JARVIS_FEATURES,
  price: (feature, usage) => costUsd(modelFor(feature as JarvisFeature), usage),
};
