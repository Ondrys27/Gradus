import { settingsEvents } from "@/lib/analytics/settings-events";
import type { OpsEnv } from "@/lib/ops";
import { USER_SETTINGS_COLUMNS, type UserSettingsPatch } from "@/lib/user-settings";

/**
 * Saves a patch of the user's own settings (always their own row, also in a
 * company), shared by Settings and Grady's tools. A locked theme is refused
 * by the database (game mode); the events carry codes, never anything typed.
 */
export async function updateSettings(
  env: OpsEnv,
  args: { userId: string; patch: UserSettingsPatch },
) {
  const { data, error } = await env.db
    .from("user_settings")
    .update(args.patch)
    .eq("user_id", args.userId)
    .select(USER_SETTINGS_COLUMNS)
    .single();
  if (error) throw error;
  for (const props of settingsEvents(args.patch)) env.track("settings_changed", props);
  return data;
}
