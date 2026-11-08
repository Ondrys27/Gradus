import "server-only";
import { toPlanSnapshot } from "@/features/plan/plan";
import { GRANT_ROWS_LIMIT, grantsFromRows } from "@/features/workers/permissions-catalog";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { USER_SETTINGS_COLUMNS } from "@/lib/user-settings";
import { toSpaces } from "./spaces";
import { PROFILE_COLUMNS, type AccountSnapshot, type WorkerAccount } from "./types";

/**
 * Verifies the session and loads profile, settings, roles and the active
 * space in one go. Runs in the app layout, which Next.js keeps across page
 * changes, so this happens once per app start (and after a switch of the
 * space, which reloads the app), never per navigation.
 *
 * The active space is the database's answer (current_workspace_id() with the
 * cookie the server client sends): the space picked when the account belongs
 * there, else its default. The worker record is the one of that space.
 */
export async function loadAccount(): Promise<AccountSnapshot | null> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return null;
  const userId = claims.sub;

  const fetchAll = () =>
    Promise.all([
      supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle(),
      supabase
        .from("user_settings")
        .select(USER_SETTINGS_COLUMNS)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.rpc("current_workspace_id"),
      supabase.rpc("my_spaces"),
    ]);

  let [profile, settings, roles, space, spaceRows] = await fetchAll();

  // Accounts created before the sign-up trigger existed get initialised on first visit.
  if (!profile.data || !settings.data) {
    const { error } = await createAdminClient().rpc("initialize_user", { _user_id: userId });
    if (error) throw error;
    [profile, settings, roles, space, spaceRows] = await fetchAll();
  }
  if (!profile.data || !settings.data) throw new Error("Account data is missing");
  if (space.error) throw space.error;
  if (spaceRows.error) throw spaceRows.error;
  const spaceId = space.data ?? userId;

  // The worker record of the active space; none in the account's own.
  const workerRow =
    spaceId === userId
      ? { data: null, error: null }
      : await supabase
          .from("workers")
          .select("id, owner_id, name, job_title")
          .eq("user_id", userId)
          .eq("owner_id", spaceId)
          .eq("status", "active")
          .maybeSingle();
  if (workerRow.error) throw workerRow.error;

  let worker: WorkerAccount | null = null;
  if (workerRow.data) {
    // RLS returns only this worker's own rights.
    const { data: grants, error } = await supabase
      .from("worker_permission_grants")
      .select("section, action, allowed")
      .eq("worker_id", workerRow.data.id)
      .limit(GRANT_ROWS_LIMIT);
    if (error) throw error;
    worker = {
      id: workerRow.data.id,
      ownerId: workerRow.data.owner_id,
      name: workerRow.data.name,
      jobTitle: workerRow.data.job_title,
      grants: grantsFromRows(grants),
    };
  }

  // The active space's plan: in a company, the owner's.
  const { data: planRows, error: planError } = await supabase.rpc("current_plan", {
    _user_id: worker?.ownerId ?? userId,
  });
  if (planError) console.error("[account] current_plan failed", planError);

  return {
    plan: toPlanSnapshot(planRows?.[0] ?? null),
    user: { id: userId, email: typeof claims.email === "string" ? claims.email : "" },
    profile: profile.data,
    settings: settings.data,
    roles: (roles.data ?? []).map((row) => row.role),
    worker,
    spaceId: worker?.ownerId ?? userId,
    spaces: toSpaces(spaceRows.data),
  };
}
