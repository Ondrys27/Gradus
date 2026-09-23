import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { HOME_PATH, loginUrlFor, routeKind, safeNextPath } from "@/lib/auth/routes";
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

/**
 * Refreshes the Supabase session cookies and guards pages.
 * `getClaims()` verifies the JWT locally with the project's signing keys, so a
 * page change never waits on a round trip to the auth server.
 */
export async function middleware(request: NextRequest) {
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
  const kind = routeKind(pathname);

  if (kind === "protected" && !signedIn) {
    return redirectKeepingCookies(request, response, loginUrlFor(pathname + search));
  }
  if (kind === "guest" && signedIn) {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    return redirectKeepingCookies(request, response, next);
  }
  if (kind === "reset" && !signedIn) {
    return redirectKeepingCookies(request, response, "/forgot-password?expired=1");
  }
  if (pathname === "/" && signedIn) {
    return redirectKeepingCookies(request, response, HOME_PATH);
  }

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
