/**
 * Addresses of the whole site in one place. The app lives under /app and
 * takes its language from the account; the public site and the sign-in pages
 * carry their language in the address: Czech by default, English under /en.
 *
 * Imported by next.config.ts too, so only relative imports here.
 */

export type SiteLocale = "cs" | "en";
export const SITE_LOCALES: readonly SiteLocale[] = ["cs", "en"];
/** The public site speaks Czech unless the address says /en. */
export const DEFAULT_SITE_LOCALE: SiteLocale = "cs";

/** The dashboard; where the app lands after sign-in. */
export const APP_HOME_PATH = "/app";
/** Choosing a plan after or during the trial. */
export const PLAN_PATH = "/app/tarif";

/** Public pages and sign-in pages with their address in each language. */
export const LOCALIZED_PAGES = {
  home: { cs: "/", en: "/en" },
  pricing: { cs: "/cenik", en: "/en/pricing" },
  terms: { cs: "/podminky", en: "/en/terms" },
  privacy: { cs: "/soukromi", en: "/en/privacy" },
  login: { cs: "/prihlaseni", en: "/en/login" },
  register: { cs: "/registrace", en: "/en/register" },
  forgotPassword: { cs: "/zapomenute-heslo", en: "/en/forgot-password" },
  resetPassword: { cs: "/nove-heslo", en: "/en/reset-password" },
  waitlistConfirmed: { cs: "/cekaci-listina", en: "/en/waitlist" },
} as const satisfies Record<string, Record<SiteLocale, string>>;

export type LocalizedPage = keyof typeof LOCALIZED_PAGES;

/** In-page anchors of the home page, named in the page's language. */
export const HOME_ANCHORS = {
  preview: { cs: "ukazka", en: "preview" },
  features: { cs: "funkce", en: "features" },
  howItWorks: { cs: "jak-to-funguje", en: "how-it-works" },
  pricing: { cs: "cenik", en: "pricing" },
  faq: { cs: "caste-otazky", en: "faq" },
} as const satisfies Record<string, Record<SiteLocale, string>>;

/** A section of the home page from anywhere on the site, e.g. `/#funkce`, `/en#features`. */
export function homeAnchor(locale: SiteLocale, anchor: keyof typeof HOME_ANCHORS): string {
  return `${LOCALIZED_PAGES.home[locale]}#${HOME_ANCHORS[anchor][locale]}`;
}

/** In-page anchor id of a home page section. */
export function homeAnchorId(locale: SiteLocale, anchor: keyof typeof HOME_ANCHORS): string {
  return HOME_ANCHORS[anchor][locale];
}

/** Pages of the marketing site (its own layout, no app around it). */
export const MARKETING_PAGES = [
  "home",
  "pricing",
  "terms",
  "privacy",
  "waitlistConfirmed",
] as const satisfies readonly LocalizedPage[];

export function toSiteLocale(value: string | null | undefined): SiteLocale {
  return value === "en" ? "en" : DEFAULT_SITE_LOCALE;
}

export function localizedPath(page: LocalizedPage, locale: string | null | undefined): string {
  return LOCALIZED_PAGES[page][toSiteLocale(locale)];
}

/** Which localized page an address is, and in which language; null for anything else. */
export function pageForPath(
  pathname: string,
): { page: LocalizedPage; locale: SiteLocale } | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const [page, paths] of Object.entries(LOCALIZED_PAGES)) {
    for (const locale of SITE_LOCALES) {
      if (paths[locale] === clean) return { page: page as LocalizedPage, locale };
    }
  }
  return null;
}

/** The same page in the other language, or null when the address has no language. */
export function switchLocalePath(pathname: string, locale: SiteLocale): string | null {
  const match = pageForPath(pathname);
  return match ? LOCALIZED_PAGES[match.page][locale] : null;
}

/**
 * Addresses from before the app moved under /app. Each answers 301 with the
 * rest of the path and the query kept. The old sign-in pages were English.
 */
export const LEGACY_REDIRECTS: readonly (readonly [from: string, to: string])[] = [
  ["/dashboard", "/app"],
  ["/milestones", "/app/milniky"],
  ["/tasks", "/app/ukoly"],
  ["/pipeline", "/app/pipeline"],
  ["/contacts/tables", "/app/kontakty/tabulky"],
  ["/contacts", "/app/kontakty"],
  ["/cold-calling", "/app/cold-calling"],
  ["/calendar", "/app/kalendar"],
  ["/finance", "/app/finance"],
  ["/profile", "/app/profil"],
  ["/workers/rewards", "/app/pracovnici/odmeny"],
  ["/workers", "/app/pracovnici"],
  ["/rewards", "/app/odmeny"],
  ["/settings", "/app/nastaveni"],
  ["/login", "/en/login"],
  ["/register", "/en/register"],
  ["/forgot-password", "/en/forgot-password"],
  ["/reset-password", "/en/reset-password"],
];

/** The new address of an old one, or null when it is not an old address. */
export function legacyRedirectTarget(pathname: string): string | null {
  for (const [from, to] of LEGACY_REDIRECTS) {
    if (pathname === from) return to;
    if (pathname.startsWith(`${from}/`)) return to + pathname.slice(from.length);
  }
  return null;
}
