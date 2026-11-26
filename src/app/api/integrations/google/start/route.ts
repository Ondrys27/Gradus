import { NextResponse, type NextRequest } from "next/server";
import {
  CALENDAR_SETTINGS_PATH,
  GOOGLE_CALLBACK_PATH,
  SCHEDULER_AVAILABILITY_PATH,
} from "@/features/calendar/sync/paths";
import { googleAuthUrl } from "@/features/calendar/sync/providers/google";
import { googleClient } from "@/features/calendar/sync/server/connections";
import { calendarSyncGate } from "@/features/calendar/sync/server/gate";
import {
  codeChallenge,
  encodeOAuthState,
  newOAuthState,
  OAUTH_COOKIE,
  type OAuthBack,
  OAUTH_COOKIE_PATH,
  OAUTH_MAX_AGE_S,
} from "@/features/calendar/sync/server/oauth-state";
import { siteOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";

/**
 * "Connect Google" (28.10): only an account the switch lets in, on a server
 * with the key and Google's client, goes to Google's consent page; the
 * state and the PKCE verifier wait in a short httpOnly cookie.
 */
export async function GET(request: NextRequest) {
  const origin = await siteOrigin();
  // Started from the scheduler (30.4): the answer returns to its Availability.
  const back: OAuthBack =
    request.nextUrl.searchParams.get("from") === "scheduler" ? "scheduler" : "settings";
  const gate = await calendarSyncGate("calendar.googleStart", "google");
  if (!gate.ok) {
    if (gate.error === "unauthenticated")
      return NextResponse.redirect(new URL("/prihlaseni", origin));
    const page =
      back === "scheduler" ? `${SCHEDULER_AVAILABILITY_PATH}&` : `${CALENDAR_SETTINGS_PATH}?`;
    return NextResponse.redirect(new URL(`${page}google=${gate.error}`, origin));
  }
  const client = googleClient()!;
  const state = newOAuthState(gate.userId, Date.now(), back);
  const response = NextResponse.redirect(
    googleAuthUrl({
      clientId: client.clientId,
      redirectUri: `${origin}${GOOGLE_CALLBACK_PATH}`,
      state: state.state,
      codeChallenge: codeChallenge(state.verifier),
    }),
  );
  response.cookies.set(OAUTH_COOKIE, encodeOAuthState(state), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_MAX_AGE_S,
  });
  return response;
}
