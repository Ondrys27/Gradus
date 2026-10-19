import {
  APP_HOME_PATH,
  DEFAULT_SITE_LOCALE,
  localizedPath,
  MARKETING_PAGES,
  pageForPath,
  type SiteLocale,
} from "@/lib/routes";

/** Where the app lands after sign-in when there is nowhere else to go. */
export const HOME_PATH = APP_HOME_PATH;
/** The Czech sign-in page; `loginPath(locale)` for the visitor's language. */
export const LOGIN_PATH = localizedPath("login", DEFAULT_SITE_LOCALE);

/** Pages only for signed-out visitors; a signed-in user is sent on. */
const GUEST_PAGES = new Set(["login", "register", "forgotPassword"]);

/** Reachable without a session: the e-mail link handler and routes with their own checks. */
const OPEN_PREFIXES = ["/auth/", "/api/"];

/** Only these need a session; everything else is the public site or a 404. */
const PROTECTED_PREFIXES = [APP_HOME_PATH, "/design-system"];

/**
 * guest: sign-in pages · reset: needs the recovery session from the e-mail ·
 * public: the marketing site · open: own checks or none · protected: the app.
 */
export type RouteKind = "guest" | "reset" | "public" | "open" | "protected";

export function routeKind(pathname: string): RouteKind {
  const page = pageForPath(pathname)?.page;
  if (page && GUEST_PAGES.has(page)) return "guest";
  if (page === "resetPassword") return "reset";
  if (page && (MARKETING_PAGES as readonly string[]).includes(page)) return "public";
  if (OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return "open";
  if (PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))
    return "protected";
  return "open";
}

/** The reset-password page in either language, when `path` is one. */
export function isResetPasswordPath(path: string | null | undefined): boolean {
  return Boolean(path) && pageForPath(path!)?.page === "resetPassword";
}

export function loginPath(locale: string | null | undefined): string {
  return localizedPath("login", locale);
}

/** Which paths a `next` target may point to, and where to go otherwise. */
export type NextPathScope = {
  accepts: (pathname: string) => boolean;
  fallback: string;
};

/** The app: any protected page, otherwise the app's home. */
export const APP_NEXT_SCOPE: NextPathScope = {
  accepts: (pathname) => routeKind(pathname) === "protected",
  fallback: HOME_PATH,
};

/**
 * The `next` target after sign-in. Only same-origin relative paths inside the
 * scope (the app by default) are allowed, so a sign-in form can never be used
 * to bounce someone to another site.
 */
export function safeNextPath(
  next: string | null | undefined,
  scope: NextPathScope = APP_NEXT_SCOPE,
): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return scope.fallback;
  }
  try {
    const url = new URL(next, "http://local");
    if (url.origin !== "http://local") return scope.fallback;
    if (!scope.accepts(url.pathname)) return scope.fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return scope.fallback;
  }
}

/** The sign-in page in the visitor's language, remembering where they wanted to go. */
export function loginUrlFor(pathWithSearch: string, locale: SiteLocale | string = "cs"): string {
  const next = safeNextPath(pathWithSearch);
  const login = loginPath(locale);
  return next === HOME_PATH ? login : `${login}?next=${encodeURIComponent(next)}`;
}
