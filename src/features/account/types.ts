import type { Database } from "@/types/database";
import type { UserSettings } from "@/lib/user-settings";

export type AppRole = Database["public"]["Enums"]["app_role"];

export type SessionUser = { id: string; email: string };

export type Profile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "username" | "display_name" | "avatar_url" | "industry" | "onboarding_completed_at"
>;

export const PROFILE_COLUMNS =
  "id, username, display_name, avatar_url, industry, onboarding_completed_at" as const;

/** Section of the owner's app a worker may be given, and what they may do there. */
export type WorkerAccess = { view: boolean; edit: boolean };

/** The account works for an owner: it gets the worker environment. */
export type WorkerAccount = {
  id: string;
  ownerId: string;
  name: string;
  jobTitle: string | null;
  /** Keyed by app_section; a missing section is not allowed. */
  permissions: Partial<Record<Database["public"]["Enums"]["app_section"], WorkerAccess>>;
};

/** Everything the app needs about the account, loaded once when the app starts. */
export type AccountSnapshot = {
  user: SessionUser;
  profile: Profile;
  settings: UserSettings;
  roles: AppRole[];
  worker: WorkerAccount | null;
};
