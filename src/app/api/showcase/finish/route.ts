import { NextResponse } from "next/server";
import { stagePresenter } from "@/features/tutorial/showcase/access";
import { SCENARIO_IDS } from "@/features/tutorial/showcase/params";
import { loadShowcaseAccess } from "@/features/tutorial/showcase/server/settings";
import { deleteStage } from "@/features/tutorial/showcase/server/stage";
import { instrumentRoute } from "@/lib/analytics/instrument";
import { track } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTCOMES = ["done", "stopped", "failed"] as const;

/**
 * The end of a showcase (step 27.4), played to the end or stopped with Esc:
 * the stage signs out and is deleted with every row it had, so no sample
 * data stays behind. Only a stage may end itself.
 */
export const POST = instrumentRoute("api.showcase.finish", async (request: Request) => {
  const access = await loadShowcaseAccess();
  if (!access || access.role !== "stage") {
    return NextResponse.json({ error: "notFound" }, { status: 404 });
  }
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const outcome = OUTCOMES.find((value) => value === body.outcome) ?? "stopped";
  const scenario =
    [...SCENARIO_IDS, "all" as const].find((value) => value === body.scenario) ?? "all";
  const seconds =
    typeof body.seconds === "number" && Number.isFinite(body.seconds)
      ? Math.min(Math.max(Math.round(body.seconds), 0), 3600)
      : 0;

  const admin = createAdminClient();
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  await deleteStage(admin, access.userId);

  await track(
    "showcase_finished",
    { scenario, outcome, seconds },
    { userId: stagePresenter(access.appMetadata) ?? null, admin },
  );
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
