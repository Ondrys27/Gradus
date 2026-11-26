import { after, NextResponse, type NextRequest } from "next/server";
import {
  CALENDAR_SETTINGS_PATH,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_PUSH_PATH,
  SCHEDULER_AVAILABILITY_PATH,
} from "@/features/calendar/sync/paths";
import { addConnectionToScheduler } from "@/features/scheduler/server/scheduler-sources";
import {
  createGoogleProvider,
  exchangeGoogleCode,
} from "@/features/calendar/sync/providers/google";
import { saveConnection } from "@/features/calendar/sync/server/connect";
import { fetcher, googleClient, timeZoneOf } from "@/features/calendar/sync/server/connections";
import { calendarSyncGate } from "@/features/calendar/sync/server/gate";
import {
  decodeOAuthState,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  oauthStateMatches,
} from "@/features/calendar/sync/server/oauth-state";
import { ensureChannels, syncUser } from "@/features/calendar/sync/server/sync";
import { ProviderError } from "@/features/calendar/sync/types";
import { siteOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Google's answer (28.10): the same account that started, the same state
 * (cookie), the switch asked again; then the code for tokens (with every
 * scope granted), the calendars listed, the connection stored encrypted, and
 * the first read and Google's notifications set up after the answer.
 */
export async function GET(request: NextRequest) {
  const origin = await siteOrigin();
  const stored = decodeOAuthState(request.cookies.get(OAUTH_COOKIE)?.value);
  // Started from the scheduler (30.4): back to its Availability.
  const fromScheduler = stored?.back === "scheduler";
  const back = (result: string) => {
    const page = fromScheduler ? `${SCHEDULER_AVAILABILITY_PATH}&` : `${CALENDAR_SETTINGS_PATH}?`;
    const response = NextResponse.redirect(new URL(`${page}google=${result}`, origin));
    response.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return response;
  };

  const gate = await calendarSyncGate("calendar.googleCallback", "google");
  if (!gate.ok) {
    if (gate.error === "unauthenticated")
      return NextResponse.redirect(new URL("/prihlaseni", origin));
    return back(gate.error);
  }
  const url = request.nextUrl;
  if (!oauthStateMatches(stored, { state: url.searchParams.get("state"), userId: gate.userId })) {
    return back("expired");
  }
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2000) return back("failed");

  const { admin, userId } = gate;
  try {
    const client = googleClient()!;
    const tokens = await exchangeGoogleCode(fetcher, client, {
      code,
      redirectUri: `${origin}${GOOGLE_CALLBACK_PATH}`,
      codeVerifier: stored!.verifier,
    });
    const provider = createGoogleProvider({
      tokens,
      client,
      fetcher,
      timeZone: await timeZoneOf(admin, userId),
    });
    const calendars = await provider.listCalendars();
    const primary = calendars.find((calendar) => calendar.isPrimary);
    const { connectionId } = await saveConnection(admin, {
      userId,
      provider: "google",
      // The primary calendar's id is the account's address.
      accountLabel:
        primary && primary.externalId.includes("@") ? primary.externalId.slice(0, 320) : null,
      secret: { kind: "google", ...tokens },
      calendars,
    });
    // Connected for the scheduler: its calendar read in Gradus counts there too.
    if (fromScheduler)
      await addConnectionToScheduler(admin, userId, connectionId).catch(() => undefined);
    after(async () => {
      const { data: connection } = await admin
        .from("calendar_connections")
        .select("id, user_id, provider, secret_cipher")
        .eq("id", connectionId)
        .eq("user_id", userId)
        .maybeSingle();
      if (connection) {
        await ensureChannels(admin, connection, `${origin}${GOOGLE_PUSH_PATH}`).catch(() => 0);
      }
      await syncUser(admin, userId, { trigger: "connect", connectionId }).catch((error) =>
        console.error(
          "[calendar-sync] first sync failed",
          error instanceof Error ? error.message : "unknown",
        ),
      );
    });
    return back("connected");
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : "unknown";
    console.error("[calendar-sync] google connect failed", code);
    return back(code === "forbidden" ? "scopes" : "failed");
  }
}
