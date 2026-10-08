/**
 * Pages of the app as analytics knows them: the route pattern (ids replaced)
 * and the section it belongs to. Anything else is `other`, so an address can
 * never carry an id or a search term into the data.
 */

export const ANALYTICS_SECTIONS = [
  "platform",
  "account",
  "onboarding",
  "dashboard",
  "milestones",
  "contacts",
  "generation",
  "pipeline",
  "cold_calling",
  "calendar",
  "finance",
  "workers",
  "search",
  "email",
  "settings",
  "jarvis",
  "game",
  "plan",
] as const;
export type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number];

const ROUTE_SECTIONS = {
  "/app": "dashboard",
  "/app/milniky": "milestones",
  "/app/milniky/[id]": "milestones",
  "/app/kontakty": "contacts",
  "/app/kontakty/[id]": "contacts",
  "/app/kontakty/tabulky": "contacts",
  "/app/pipeline": "pipeline",
  "/app/cold-calling": "cold_calling",
  "/app/kalendar": "calendar",
  "/app/finance": "finance",
  "/app/pracovnici": "workers",
  "/app/pracovnici/[id]": "workers",
  "/app/pracovnici/odmeny": "workers",
  "/app/ukoly": "workers",
  "/app/odmeny": "workers",
  "/app/nastaveni": "settings",
  "/app/profil": "account",
  "/app/tarif": "plan",
  other: "platform",
} as const satisfies Record<string, AnalyticsSection>;

export type AppRoute = keyof typeof ROUTE_SECTIONS;
export const APP_ROUTES = Object.keys(ROUTE_SECTIONS) as [AppRoute, ...AppRoute[]];

/** Fixed sub-pages that look like an id segment. */
const STATIC_SEGMENTS = new Set(["tabulky", "odmeny"]);

/** The route pattern of an address; ids become `[id]`, unknown pages `other`. */
export function routeOf(pathname: string): AppRoute {
  const clean = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (clean in ROUTE_SECTIONS) return clean as AppRoute;
  const parts = clean.split("/");
  if (parts.length === 4 && !STATIC_SEGMENTS.has(parts[3])) {
    const pattern = `${parts.slice(0, 3).join("/")}/[id]`;
    if (pattern in ROUTE_SECTIONS) return pattern as AppRoute;
  }
  return "other";
}

export function sectionOf(route: AppRoute): AnalyticsSection {
  return ROUTE_SECTIONS[route];
}
