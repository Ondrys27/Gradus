import type { NavKey } from "@/components/layout/nav-items";

/** Must match the `kind` check constraint on xp_events and the case in award_xp(). */
export type XpKind =
  | "milestone_completed"
  | "deal_won"
  | "section_unlocked"
  | "contacts_generated_first"
  | "meeting_tenth"
  | "task_completed"
  | "contact_moved"
  | "onboarding_completed";

export type XpSummary = { totalXp: number; streak: number };

/** The four sections a new account has not earned yet. */
export type LockableSection = Extract<NavKey, "coldCalling" | "calendar" | "finance" | "workers">;

/** The `unlocks.key` each section is granted under by section_unlocks(). */
export const SECTION_UNLOCK_KEYS: Record<LockableSection, string> = {
  coldCalling: "section_cold_calling",
  calendar: "section_calendar",
  finance: "section_finance",
  workers: "section_workers",
};

export type SectionUnlockRow = {
  key: string;
  unlocked: boolean;
  unlocked_at: string | null;
  seen_at: string | null;
  progress: number;
  needed: number;
};

export type SectionUnlockState = SectionUnlockRow & {
  /** Unlocked but the user has not opened the section since. */
  fresh: boolean;
};
