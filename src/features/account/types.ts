import type { Database } from "@/types/database";
import type { UserSettings } from "@/lib/user-settings";

export type AppRole = Database["public"]["Enums"]["app_role"];

export type SessionUser = { id: string; email: string };

export type Profile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "username" | "display_name" | "avatar_url"
>;

export const PROFILE_COLUMNS = "id, username, display_name, avatar_url" as const;

/** Everything the app needs about the account, loaded once when the app starts. */
export type AccountSnapshot = {
  user: SessionUser;
  profile: Profile;
  settings: UserSettings;
  roles: AppRole[];
};
