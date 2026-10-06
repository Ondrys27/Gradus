import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The name under the founder's note: the display name of the owner account
 * (the first `owner` in user_roles), read when the page is generated. The
 * admin client is used without a session on purpose: it reads one column
 * the owner shows publicly, and nothing else. Without a key or a name the
 * note is signed only with the role.
 */
export async function founderName(): Promise<string | null> {
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const admin = createAdminClient();
    const { data: role } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "owner")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (!role) return null;
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", role.user_id)
      .maybeSingle();
    const name = profile?.display_name?.trim();
    return name ? name.slice(0, 80) : null;
  } catch (error) {
    console.error("[marketing] founder name lookup failed", error);
    return null;
  }
}
