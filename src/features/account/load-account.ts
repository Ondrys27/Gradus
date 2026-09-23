import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { USER_SETTINGS_COLUMNS } from "@/lib/user-settings";
import { PROFILE_COLUMNS, type AccountSnapshot } from "./types";

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
    ]);

  let [profile, settings, roles] = await fetchAll();

  // Accounts created before the sign-up trigger existed get initialised on first visit.
  if (!profile.data || !settings.data) {
    const { error } = await createAdminClient().rpc("initialize_user", { _user_id: userId });
    if (error) throw error;
    [profile, settings, roles] = await fetchAll();
  }
  if (!profile.data || !settings.data) throw new Error("Account data is missing");

  return {
    user: { id: userId, email: typeof claims.email === "string" ? claims.email : "" },
    profile: profile.data,
    settings: settings.data,
    roles: (roles.data ?? []).map((row) => row.role),
  };
}
