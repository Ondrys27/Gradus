import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/**
 * Where ideas, plan requests and Jarvis's budget alerts go: OWNER_EMAIL,
 * otherwise the owner account's e-mail and language.
 */
export async function ownerContact(
  admin: Client,
): Promise<{ email: string | null; locale: string | null }> {
  const { data: role } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "owner")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  const [user, settings] = role
    ? await Promise.all([
        admin.auth.admin.getUserById(role.user_id),
        admin.from("user_settings").select("locale").eq("user_id", role.user_id).maybeSingle(),
      ])
    : [null, null];
  return {
    email: process.env.OWNER_EMAIL || user?.data.user?.email || null,
    locale: settings?.data?.locale ?? null,
  };
}
