import "server-only";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { peopleNamer } from "./people";

/**
 * Who last changed a setting of the administration and when, by name (never
 * a role, step 27.2): "Váša, 13. 11. 2026 14:05". Null when it was never
 * saved or cannot be read; the card simply leaves the line out.
 */
export async function lastSettingChange(key: string): Promise<{ name: string; date: string } | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("app_settings")
      .select("updated_at, updated_by")
      .eq("key", key)
      .maybeSingle();
    if (error || !data?.updated_by || !data.updated_at) return null;
    const nameOf = await peopleNamer([data.updated_by]);
    return {
      name: nameOf(data.updated_by),
      date: formatDateTime(new Date(data.updated_at), ADMIN_FORMAT_SETTINGS),
    };
  } catch {
    return null;
  }
}
