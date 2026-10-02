import type { XpReason } from "./rules";
import type {
  AwardResult,
  EarnedAchievement,
  GameMode,
  GameState,
  LocalizedText,
  SectionState,
  UnlockedItem,
} from "./types";

/** award_xp() and game_state() return jsonb in snake_case; these turn it into app types. */

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}
function asText(value: unknown): LocalizedText {
  const o = asObject(value);
  return { en: String(o.en ?? ""), cs: String(o.cs ?? "") };
}
function asTextOrNull(value: unknown): LocalizedText | null {
  return value && typeof value === "object" ? asText(value) : null;
}
function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseUnlock(value: unknown): UnlockedItem {
  const o = asObject(value);
  return {
    key: String(o.key ?? ""),
    kind: (o.kind as UnlockedItem["kind"]) ?? "feature",
    name: asText(o.name),
    description: asText(o.description),
    icon: String(o.icon ?? ""),
    source: o.source === "milestone" ? "milestone" : "level",
    level: o.level == null ? null : asNumber(o.level),
  };
}

function parseAchievement(value: unknown): EarnedAchievement {
  const o = asObject(value);
  return {
    key: String(o.key ?? ""),
    name: asText(o.name),
    description: asText(o.description),
    icon: String(o.icon ?? ""),
  };
}

export function parseAwardResult(value: unknown): AwardResult {
  const o = asObject(value);
  return {
    awarded: o.awarded === true,
    xp: asNumber(o.xp),
    reason: String(o.reason ?? "") as XpReason,
    totalXp: asNumber(o.total_xp),
    previousLevel: asNumber(o.previous_level, 1),
    level: asNumber(o.level, 1),
    leveledUp: o.leveled_up === true,
    unlocks: asArray(o.unlocks).map(parseUnlock),
    achievements: asArray(o.achievements).map(parseAchievement),
    streak: asNumber(o.streak),
  };
}

function parseSection(value: unknown): SectionState {
  const o = asObject(value);
  const milestone = o.milestone ? asObject(o.milestone) : null;
  return {
    key: String(o.key ?? ""),
    unlocked: o.unlocked === true,
    unlockedAt: asStringOrNull(o.unlocked_at),
    seenAt: asStringOrNull(o.seen_at),
    level: o.level == null ? null : asNumber(o.level),
    milestone: milestone
      ? {
          id: String(milestone.id ?? ""),
          title: String(milestone.title ?? ""),
          completed: milestone.completed === true,
        }
      : null,
    templateTitle: asTextOrNull(o.template_title),
  };
}

export function parseGameState(value: unknown): GameState {
  const o = asObject(value);
  const mode: GameMode = o.mode === "tool" ? "tool" : "game";
  return {
    mode,
    pathKey: asStringOrNull(o.path_key),
    totalXp: asNumber(o.total_xp),
    level: asNumber(o.level, 1),
    levelXp: asNumber(o.level_xp),
    nextLevelXp: o.next_level_xp == null ? null : asNumber(o.next_level_xp),
    streak: asNumber(o.streak),
    streakFreezeAvailable: o.streak_freeze_available !== false,
    unlocked: asArray(o.unlocked).map(String),
    sections: asArray(o.sections).map(parseSection),
  };
}
