import { NextResponse } from "next/server";
import { CALENDAR_SETTINGS_PATH, GOOGLE_CALLBACK_PATH } from "@/features/calendar/sync/paths";
import { googleAuthUrl } from "@/features/calendar/sync/providers/google";
import { googleClient } from "@/features/calendar/sync/server/connections";
import { calendarSyncGate } from "@/features/calendar/sync/server/gate";
import {
  codeChallenge,
  encodeOAuthState,
  newOAuthState,
  OAUTH_COOKIE,
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
export async function GET() {
  const origin = await siteOrigin();
  const gate = await calendarSyncGate("calendar.googleStart", "google");
  if (!gate.ok) {
    if (gate.error === "unauthenticated") return NextResponse.redirect(new URL("/prihlaseni", origin));
    return NextResponse.redirect(new URL(`${CALENDAR_SETTINGS_PATH}?google=${gate.error}`, origin));
  }
  const client = googleClient()!;
  const state = newOAuthState(gate.userId);
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
