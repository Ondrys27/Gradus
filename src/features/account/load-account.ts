import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { USER_SETTINGS_COLUMNS } from "@/lib/user-settings";
import { PROFILE_COLUMNS, type AccountSnapshot, type WorkerAccount } from "./types";

/**
 * Verifies the session and loads profile, settings and roles in one go.
 * Runs in the app layout, which Next.js keeps across page changes, so this
 * happens once per app start, never per navigation.
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
      supabase
        .from("workers")
        .select("id, owner_id, name, job_title")
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle(),
    ]);

  let [profile, settings, roles, workerRow] = await fetchAll();

  // Accounts created before the sign-up trigger existed get initialised on first visit.
  if (!profile.data || !settings.data) {
    const { error } = await createAdminClient().rpc("initialize_user", { _user_id: userId });
    if (error) throw error;
    [profile, settings, roles, workerRow] = await fetchAll();
  }
  if (!profile.data || !settings.data) throw new Error("Account data is missing");
  if (workerRow.error) throw workerRow.error;

  let worker: WorkerAccount | null = null;
  if (workerRow.data) {
    // RLS returns only this worker's own permissions.
    const { data: permissions, error } = await supabase
      .from("worker_permissions")
      .select("section, can_view, can_edit")
      .eq("worker_id", workerRow.data.id);
    if (error) throw error;
    worker = {
      id: workerRow.data.id,
      ownerId: workerRow.data.owner_id,
      name: workerRow.data.name,
      jobTitle: workerRow.data.job_title,
      permissions: Object.fromEntries(
        permissions.map((row) => [row.section, { view: row.can_view, edit: row.can_edit }]),
      ),
    };
  }

  return {
    user: { id: userId, email: typeof claims.email === "string" ? claims.email : "" },
    profile: profile.data,
    settings: settings.data,
    roles: (roles.data ?? []).map((row) => row.role),
    worker,
  };
}
