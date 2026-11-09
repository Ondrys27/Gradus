import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  ADMIN_PATH_HEADER,
  adminLoginUrl,
  claimsMayEnterAdmin,
  isAdminPath,
  isAdminPublicPath,
  parseSessionStatus,
} from "@/features/admin/access";
import {
  PROMO_COOKIE,
  PROMO_COOKIE_MAX_AGE,
  PROMO_PARAM,
  promoCodeFromParam,
} from "@/features/promo/link";
import {
  CURRENCY_COOKIE_MAX_AGE,
  GEO_CURRENCY_COOKIE,
  geoCurrency,
} from "@/features/currency/visitor-currency";
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
  // The public booking pages (24.4) store nothing but the guest's own language and zone.
  if (isBookingPath(request.nextUrl.pathname)) {
    if (request.nextUrl.pathname.startsWith("/s/r/")) {
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
      response.headers.set("Referrer-Policy", "no-referrer");
    }
    return response;
  }
  // A partner's link (…/?kod=XYZ): the code waits 30 days for the registration.
  const promo = promoCodeFromParam(request.nextUrl.searchParams.get(PROMO_PARAM));
  if (promo) {
    response.cookies.set(PROMO_COOKIE, promo, {
      path: "/",
      maxAge: PROMO_COOKIE_MAX_AGE,
      sameSite: "lax",
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
    });
  }
  // The price list's currency by the visitor's country (Vercel's header); only a code.
  const geo = geoCurrency(request.headers.get("x-vercel-ip-country"));
  if (geo && request.cookies.get(GEO_CURRENCY_COOKIE)?.value !== geo) {
    response.cookies.set(GEO_CURRENCY_COOKIE, geo, {
      path: "/",
      maxAge: CURRENCY_COOKIE_MAX_AGE,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }
  // The administration is never indexed.
  if (isAdminPath(request.nextUrl.pathname)) {
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

  // Owner or admin with the second factor and a live admin session; anyone else (signed
  // out, no second factor, an idle, expired or ended admin session) goes to the
  // sign-in, which then continues to the page asked for. The sign-in page
  // checks the role itself, after the password; an invitation page checks its
  // token.
  if (isAdminPath(pathname) && !isAdminPublicPath(pathname)) {
    let allowed = false;
    if (claimsMayEnterAdmin(data?.claims)) {
      const touched = await supabase.rpc("admin_session_touch", { _activity: true });
      allowed = !touched.error && parseSessionStatus(touched.data).status === "ok";
    }
    if (!allowed) {
      const login = adminLoginUrl(pathname + search);
      // A server action expects an answer it can read: it tells the page to go there.
      if (request.method === "POST" && request.headers.has("next-action")) {
        return withCookiesOf(
          response,
          new NextResponse(null, {
            status: 200,
            headers: { "content-type": "text/plain", "x-action-redirect": `${login};replace` },
          }),
        );
      }
      return redirectKeepingCookies(request, response, login);
    }
    // The server guard sends a session that ends mid-request back with this path.
    request.headers.set(ADMIN_PATH_HEADER, pathname + search);
    request.headers.delete(URL_LOCALE_HEADER);
    return withCookiesOf(response, NextResponse.next({ request }));
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

/** /s/<handle>, /s/<handle>/<slug> and the guest's /s/r/<token>. */
function isBookingPath(pathname: string): boolean {
  return pathname === "/s" || pathname.startsWith("/s/");
}

function withLocaleCookie(response: NextResponse, locale: SiteLocale) {
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  return response;
}

/** Any answer must carry the refreshed session cookies, or the user is signed out. */
function withCookiesOf<T extends NextResponse>(from: NextResponse, to: T): T {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  return to;
}

function redirectKeepingCookies(request: NextRequest, from: NextResponse, target: string) {
  return withCookiesOf(from, NextResponse.redirect(new URL(target, request.url)));
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3|txt|xml)$).*)",
  ],
};
