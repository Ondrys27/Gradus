import type { NavKey } from "@/components/layout/nav-items";
import type { XpReason } from "./rules";

export type GameMode = "game" | "tool";

/** Text stored in the database in both languages. */
export type LocalizedText = { en: string; cs: string };

export function localized(text: LocalizedText | null | undefined, locale: string): string {
  if (!text) return "";
  return locale === "cs" ? text.cs || text.en : text.en || text.cs;
}

export type UnlockKind = "section" | "feature" | "theme" | "jarvis_skill";

/** One thing just unlocked, as award_xp() returns it. */
export type UnlockedItem = {
  key: string;
  kind: UnlockKind;
  name: LocalizedText;
  description: LocalizedText;
  icon: string;
  source: "level" | "milestone";
  level: number | null;
};

export type EarnedAchievement = {
  key: string;
  name: LocalizedText;
  description: LocalizedText;
  icon: string;
};

/** The result of award_xp(): enough for the interface to celebrate a level-up. */
export type AwardResult = {
  awarded: boolean;
  xp: number;
  reason: XpReason;
  totalXp: number;
  previousLevel: number;
  level: number;
  leveledUp: boolean;
  unlocks: UnlockedItem[];
  achievements: EarnedAchievement[];
  streak: number;
};

/** Lock state of one section, as game_state() returns it. */
export type SectionState = {
  key: string;
  unlocked: boolean;
  unlockedAt: string | null;
  seenAt: string | null;
  /** The level that opens it, when a level does (Workers at 10). */
  level: number | null;
  /** The user's own milestone that opens it, when they have one. */
  milestone: { id: string; title: string; completed: boolean } | null;
  /** The template step of the chosen path that opens it, even if the user deleted their copy. */
  templateTitle: LocalizedText | null;
};

export type GameState = {
  mode: GameMode;
  pathKey: string | null;
  totalXp: number;
  level: number;
  levelXp: number;
  nextLevelXp: number | null;
  streak: number;
  streakFreezeAvailable: boolean;
  /** Every unlock key that is open (all of them in tool mode). */
  unlocked: string[];
  sections: SectionState[];
};

/** Sections that can be locked in game mode; Dashboard, Milestones, Jarvis and Settings never are. */
export type LockableSection = Extract<
  NavKey,
  "contacts" | "coldCalling" | "pipeline" | "calendar" | "finance" | "workers"
>;

/** The unlock_definitions key each lockable section is granted under. */
export const SECTION_UNLOCK_KEYS: Record<LockableSection, string> = {
  contacts: "section_contacts",
  coldCalling: "section_cold_calling",
  pipeline: "section_pipeline",
  calendar: "section_calendar",
  finance: "section_finance",
  workers: "section_workers",
};

export function isLockableSection(key: string): key is LockableSection {
  return key in SECTION_UNLOCK_KEYS;
}
