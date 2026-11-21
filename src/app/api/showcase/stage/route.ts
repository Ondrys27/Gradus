import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACTIVE_SPACE_COOKIE } from "@/features/account/space-cookie";
import { stagePresenter } from "@/features/tutorial/showcase/access";
import { parseShowcaseParams } from "@/features/tutorial/showcase/params";
import { loadShowcaseAccess } from "@/features/tutorial/showcase/server/settings";
import { createStage, stageSignInToken } from "@/features/tutorial/showcase/server/stage";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/i18n/locale-cookie";
import { instrumentRoute } from "@/lib/analytics/instrument";
import { track } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Making the account and its sample data takes a few seconds. */
export const maxDuration = 60;

/**
 * Starts a showcase (step 27.4): a fresh stage account with the sample data
 * in the chosen language, and this browser signed into it (the presenter's
 * own session ends here; the stage is deleted when the showcase ends).
 * Only the app's owner or an administrator while the showcase mode is on
 * (or a stage itself, for "R" = play again); anybody else gets 404, as if
 * the address did not exist.
 */
export const POST = instrumentRoute("api.showcase.stage", async (request: Request) => {
  const access = await loadShowcaseAccess();
  if (!access) return NextResponse.json({ error: "notFound" }, { status: 404 });

  const body: unknown = await request.json().catch(() => null);
  const fields = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const params = parseShowcaseParams({
    get: (name) => (typeof fields[name] === "string" ? (fields[name] as string) : null),
  });
  // A stage playing again counts for the presenter who made it.
  const presenterId =
    access.role === "stage" ? (stagePresenter(access.appMetadata) ?? access.userId) : access.userId;

  const admin = createAdminClient();
  let stage;
  try {
    stage = await createStage({ presenterId, locale: params.locale, admin });
  } catch (error) {
    console.error("[showcase] making the stage failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  // Signed into the stage in this browser; the token is used here and nowhere else.
  const token = await stageSignInToken(admin, stage.email);
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: token });
  if (error) {
    console.error("[showcase] signing into the stage failed", error.message);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  const store = await cookies();
  // The stage's own space and the scenario's language.
  store.delete(ACTIVE_SPACE_COOKIE);
  store.set(LOCALE_COOKIE, params.locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });

  await track(
    "showcase_started",
    { scenario: params.scenario, locale: params.locale, size: params.size, replay: access.role === "stage" },
    { userId: presenterId, admin },
  );
  return NextResponse.json(
    { ok: true, stage: stage.id },
    { headers: { "Cache-Control": "no-store" } },
  );
});
