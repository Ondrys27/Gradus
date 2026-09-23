/** Where the app lands after sign-in when there is nowhere else to go. */
export const HOME_PATH = "/dashboard";
export const LOGIN_PATH = "/login";

/** Pages only for signed-out visitors; a signed-in user is sent on. */
const GUEST_PATHS = ["/login", "/register", "/forgot-password"];

/** Needs the short-lived recovery session from the reset e-mail. */
export const RESET_PASSWORD_PATH = "/reset-password";

/** Reachable without a session: the e-mail link handler and routes with their own checks. */
const OPEN_PREFIXES = ["/auth/", "/api/"];

export type RouteKind = "guest" | "reset" | "open" | "protected";

export function routeKind(pathname: string): RouteKind {
  if (GUEST_PATHS.includes(pathname)) return "guest";
  if (pathname === RESET_PASSWORD_PATH) return "reset";
  if (OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return "open";
  return "protected";
}

/**
 * The `next` target after sign-in. Only same-origin paths are allowed, so the
 * login form can never be used to bounce someone to another site.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return HOME_PATH;
  }
  try {
    const url = new URL(next, "http://local");
    if (url.origin !== "http://local") return HOME_PATH;
    if (url.pathname === "/" || routeKind(url.pathname) !== "protected") return HOME_PATH;
    return url.pathname + url.search + url.hash;
  } catch {
    return HOME_PATH;
  }
}

export function loginUrlFor(pathWithSearch: string): string {
  const next = safeNextPath(pathWithSearch);
  return next === HOME_PATH ? LOGIN_PATH : `${LOGIN_PATH}?next=${encodeURIComponent(next)}`;
}
