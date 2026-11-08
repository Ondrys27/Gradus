import type { PermissionGrants } from "@/features/workers/permissions-catalog";
import type { Database } from "@/types/database";
import type { PlanSnapshot } from "@/features/plan/plan";
import type { SpaceMembership } from "./spaces";
import type { UserSettings } from "@/lib/user-settings";

export type AppRole = Database["public"]["Enums"]["app_role"];

export type SessionUser = { id: string; email: string };

export type Profile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  | "id"
  | "username"
  | "display_name"
  | "avatar_url"
  | "industry"
  | "created_at"
  | "onboarding_completed_at"
  | "mode"
  | "path_key"
  | "seen_level"
  | "tour_completed_at"
  | "tutorial"
  | "notes_intro_seen_at"
  | "nps_snoozed_until"
  | "nps_dismiss_streak"
  | "public_id"
  | "company_name"
  | "company_logo_url"
>;

export const PROFILE_COLUMNS =
  "id, username, display_name, avatar_url, industry, created_at, onboarding_completed_at, mode, path_key, seen_level, tour_completed_at, tutorial, notes_intro_seen_at, nps_snoozed_until, nps_dismiss_streak, public_id, company_name, company_logo_url" as const;

/** Section of the owner's app a worker may be given, and what they may do there. */
export type WorkerAccess = { view: boolean; edit: boolean };

/** The account works for an owner: it gets the worker environment. */
export type WorkerAccount = {
  id: string;
  ownerId: string;
  name: string;
  jobTitle: string | null;
  /** The fine rights (worker_permission_grants); a missing action is not allowed. */
  grants: PermissionGrants;
};

/** Everything the app needs about the account, loaded once when the app starts. */
export type AccountSnapshot = {
  user: SessionUser;
  profile: Profile;
  settings: UserSettings;
  roles: AppRole[];
  /** The worker record when the active space is a company the account works for; null in its own. */
  worker: WorkerAccount | null;
  /** The active space (an owner's user id): the account's own or a company it works for. */
  spaceId: string;
  /** The own space first, then every company the account works for (the switcher). */
  spaces: SpaceMembership[];
  /** Plan of the active space (the owner's for a worker). */
  plan: PlanSnapshot;
};
