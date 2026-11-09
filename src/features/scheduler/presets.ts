import type { LocationKind } from "./types";

/**
 * What a person gets the first time they open the scheduler: three meeting
 * types (names from `scheduler.presets.*` in their language) and working
 * hours Monday to Friday, 9:00–17:00. Only as many types start active as the
 * plan allows (Solo one); the rest wait switched off.
 */
export const PRESET_TYPES = [
  { key: "intro", duration: 15, location: "video" },
  { key: "consultation", duration: 30, location: "video" },
  { key: "meeting", duration: 60, location: "video" },
] as const satisfies readonly { key: string; duration: number; location: LocationKind }[];
export type PresetKey = (typeof PRESET_TYPES)[number]["key"];

export const DEFAULT_HOURS = { start: "09:00", end: "17:00" } as const;
/** Monday to Friday (0 = Sunday). */
export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5] as const;

/** How many presets start active under a limit (null = no limit). */
export function activePresetCount(limit: number | null): number {
  return limit === null ? PRESET_TYPES.length : Math.max(0, Math.min(limit, PRESET_TYPES.length));
}
