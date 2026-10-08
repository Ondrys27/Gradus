import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  ADMIN_NOT_FOUND_PATH,
  claimsMayEnterAdmin,
  isAdminLoginPath,
  isAdminPath,
  parseSessionStatus,
} from "@/features/admin/access";
import { HOME_PATH, loginUrlFor, routeKind, safeNextPath } from "@/lib/auth/routes";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, URL_LOCALE_HEADER } from "@/i18n/locale-cookie";
import { localizedPath, pageForPath, type SiteLocale } from "@/lib/routes";
import { prefersEnglish } from "@/lib/site-locale";
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

/**
 * Refreshes the Supabase session cookies, guards pages and fixes the language
 * of the public site and the sign-in pages from their address.
 * `getClaims()` verifies the JWT locally with the project's signing keys, so a
 * page change never waits on a round trip to the auth server.
 */
export async function middleware(request: NextRequest) {
  const response = await route(request);
  // The administration is never indexed. Its 404 stays identical to any other.
  if (isAdminPath(request.nextUrl.pathname) && response.status !== 404) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

async function route(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseUrl(), supabasePublicKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Nothing may run between creating the client and this call.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const { pathname, search } = request.nextUrl;

  // Owner with the second factor and a live admin session, or the site's 404.
  // The sign-in page is the only way in; it checks the role itself.
  if (isAdminPath(pathname) && !isAdminLoginPath(pathname)) {
    let allowed = false;
    if (claimsMayEnterAdmin(data?.claims)) {
      const touched = await supabase.rpc("admin_session_touch", { _activity: true });
      allowed = !touched.error && parseSessionStatus(touched.data).status === "ok";
    }
    if (!allowed) {
      const notFound = NextResponse.rewrite(new URL(ADMIN_NOT_FOUND_PATH, request.url), {
        status: 404,
      });
      response.cookies.getAll().forEach((cookie) => notFound.cookies.set(cookie));
      return notFound;
    }
  }

  const kind = routeKind(pathname);
  const page = pageForPath(pathname);
  const storedLocale = request.cookies.get(LOCALE_COOKIE)?.value;

  if (kind === "protected" && !signedIn) {
    return redirectKeepingCookies(request, response, loginUrlFor(pathname + search, storedLocale));
  }
  if (kind === "guest" && signedIn) {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    return redirectKeepingCookies(request, response, next);
  }
  if (kind === "reset" && !signedIn) {
    const forgot = localizedPath("forgotPassword", page?.locale);
    return redirectKeepingCookies(request, response, `${forgot}?expired=1`);
  }
  if (page?.page === "home" && signedIn) {
    return redirectKeepingCookies(request, response, HOME_PATH);
  }
  // The browser's language decides only on the very first visit to the home page.
  if (page?.page === "home" && page.locale === "cs" && !storedLocale) {
    if (prefersEnglish(request.headers.get("accept-language"))) {
      const redirect = redirectKeepingCookies(request, response, localizedPath("home", "en"));
      return withLocaleCookie(redirect, "en");
    }
  }

  if (!page && !request.headers.has(URL_LOCALE_HEADER)) return response;

  // The address decides the language of this page; nobody else may set the header.
  const headers = new Headers(request.headers);
  headers.delete(URL_LOCALE_HEADER);
  if (page) headers.set(URL_LOCALE_HEADER, page.locale);
  const localized = NextResponse.next({ request: { headers } });
  response.cookies.getAll().forEach((cookie) => localized.cookies.set(cookie));
  // A visitor's cookie remembers the language; an account's language comes from its settings.
  return page && !signedIn ? withLocaleCookie(localized, page.locale) : localized;
}

function withLocaleCookie(response: NextResponse, locale: SiteLocale) {
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  return response;
}

/** A redirect must carry any refreshed session cookies, or the user is signed out. */
function redirectKeepingCookies(request: NextRequest, from: NextResponse, target: string) {
  const redirect = NextResponse.redirect(new URL(target, request.url));
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3|txt|xml)$).*)",
  ],
};
