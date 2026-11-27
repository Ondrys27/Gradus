import {
  addDays,
  dayIn,
  instantAtMinute,
  offsetMinutes,
  wallOf,
  weekdayOf,
  type Day,
} from "@/features/scheduler/zoned";
import { DEFAULT_THEME, type ThemeKey } from "@/lib/themes";
import { isThemeRef, manualColumns, manualRef, parseThemeRef, type ThemeRef } from "./theme-ref";

/**
 * The theme schedule (30.6, `user_settings.theme_schedule`): blocks of the
 * day with a name, a start, a theme and an optional caption. A block lasts
 * until the next one starts, the last one of a day past midnight into the
 * next day until that day's first block. All wall clock times are in the
 * user's zone; the boundaries are computed as instants, so a DST jump moves
 * nothing by an hour. Pure, no DOM; `public.valid_theme_schedule` checks the
 * same shape.
 */

export const SCHEDULE_MODES = ["same", "weekdays", "each"] as const;
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];

export const DAY_KEYS = ["all", "weekdays", "weekend", "0", "1", "2", "3", "4", "5", "6"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const MIN_BLOCKS = 2;
export const MAX_BLOCKS = 8;
export const BLOCK_NAME_MAX = 40;
export const BLOCK_CAPTION_MAX = 120;
/** Boundaries snap to a quarter of an hour when dragged; a typed time may be any minute. */
export const SNAP_MINUTES = 15;
const DAY_MINUTES = 1440;

export type ScheduleBlock = {
  id: string;
  name: string;
  /** Minute of the day, 0 … 1439, in the user's zone. */
  start: number;
  theme: ThemeRef;
  caption: string | null;
};

export type ThemeSchedule = {
  v: 1;
  enabled: boolean;
  mode: ScheduleMode;
  days: Partial<Record<DayKey, ScheduleBlock[]>>;
};

/** The day lists a mode keeps: one list, weekdays + weekend, or Sunday … Saturday ("0" … "6"). */
export function dayKeysOf(mode: ScheduleMode): DayKey[] {
  if (mode === "same") return ["all"];
  if (mode === "weekdays") return ["weekdays", "weekend"];
  return ["1", "2", "3", "4", "5", "6", "0"];
}

/** 0 = Sunday … 6 = Saturday. Saturday and Sunday are the weekend. */
export function dayKeyFor(mode: ScheduleMode, weekday: number): DayKey {
  if (mode === "same") return "all";
  if (mode === "weekdays") return weekday === 0 || weekday === 6 ? "weekend" : "weekdays";
  return String(weekday) as DayKey;
}

const BLOCK_ID = /^[a-zA-Z0-9_-]{1,40}$/;

function parseBlock(raw: unknown): ScheduleBlock | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["id", "name", "start", "theme", "caption"].includes(key))) return null;
  const { id, name, start, theme, caption } = value;
  if (typeof id !== "string" || !BLOCK_ID.test(id)) return null;
  if (typeof name !== "string" || name.trim() !== name || name.length < 1 || name.length > BLOCK_NAME_MAX) {
    return null;
  }
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0 || start >= DAY_MINUTES) return null;
  if (!isThemeRef(theme)) return null;
  if (caption !== null && caption !== undefined) {
    if (typeof caption !== "string" || caption.trim() !== caption) return null;
    if (caption.length < 1 || caption.length > BLOCK_CAPTION_MAX) return null;
  }
  return { id, name, start, theme, caption: typeof caption === "string" ? caption : null };
}

/** A day's list: 2–8 blocks, starts strictly rising, ids unique. */
function parseDay(raw: unknown): ScheduleBlock[] | null {
  if (!Array.isArray(raw) || raw.length < MIN_BLOCKS || raw.length > MAX_BLOCKS) return null;
  const blocks: ScheduleBlock[] = [];
  for (const item of raw) {
    const block = parseBlock(item);
    if (!block) return null;
    const previous = blocks[blocks.length - 1];
    if (previous && block.start <= previous.start) return null;
    blocks.push(block);
  }
  return new Set(blocks.map((block) => block.id)).size === blocks.length ? blocks : null;
}

/** The stored schedule, strictly (as the database checks it), else null. */
export function parseThemeSchedule(raw: unknown): ThemeSchedule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["v", "enabled", "mode", "days"].includes(key))) return null;
  if (value.v !== 1 || typeof value.enabled !== "boolean") return null;
  if (typeof value.mode !== "string" || !(SCHEDULE_MODES as readonly string[]).includes(value.mode)) return null;
  const mode = value.mode as ScheduleMode;
  const days = value.days;
  if (!days || typeof days !== "object" || Array.isArray(days)) return null;
  const keys = dayKeysOf(mode);
  const record = days as Record<string, unknown>;
  if (Object.keys(record).some((key) => !(keys as string[]).includes(key))) return null;
  const parsed: ThemeSchedule["days"] = {};
  for (const key of keys) {
    const list = parseDay(record[key]);
    if (!list) return null;
    parsed[key] = list;
  }
  return { v: 1, enabled: value.enabled, mode, days: parsed };
}

/** The blocks of a weekday, sorted by start. */
export function blocksOn(schedule: ThemeSchedule, weekday: number): ScheduleBlock[] {
  return schedule.days[dayKeyFor(schedule.mode, weekday)] ?? [];
}

// --- time ---------------------------------------------------------------------

export type Boundary = { at: number; block: ScheduleBlock; day: Day };

/**
 * The instant a block starts on a day. A start skipped by a spring DST jump
 * (02:30 in Prague on the last Sunday of March) begins at the jump itself;
 * a start that happens twice in the autumn begins the first time.
 */
export function blockStartAt(day: Day, minute: number, timeZone: string): number {
  const at = instantAtMinute(day, minute, timeZone);
  const shown = wallMinuteOf(at, timeZone);
  if (shown === minute && dayIn(at, timeZone) === day) return at;
  // Skipped: `at` is past the jump; walk back to the first instant with the new offset.
  const after = offsetMinutes(at, timeZone);
  let lo = at - 3 * 3_600_000;
  let hi = at;
  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2 / 60_000) * 60_000;
    if (offsetMinutes(mid, timeZone) === after) hi = mid;
    else lo = mid;
  }
  return hi;
}

function wallMinuteOf(instant: number, timeZone: string): number {
  const wall = wallOf(instant, timeZone);
  return wall.hour * 60 + wall.minute;
}

/** Every block start from `fromDay` to `toDay` (both included), by instant. */
export function boundaries(schedule: ThemeSchedule, fromDay: Day, toDay: Day, timeZone: string): Boundary[] {
  const out: Boundary[] = [];
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    for (const block of blocksOn(schedule, weekdayOf(day))) {
      out.push({ at: blockStartAt(day, block.start, timeZone), block, day });
    }
  }
  // Stable: two starts on the same instant (a DST gap) leave the later block in charge.
  return out
    .map((boundary, index) => ({ boundary, index }))
    .sort((a, b) => a.boundary.at - b.boundary.at || a.index - b.index)
    .map(({ boundary }) => boundary);
}

export type ActiveBlock = {
  block: ScheduleBlock;
  /** When this block began (instant, ms). */
  startedAt: number;
  /** When the next block begins. */
  endsAt: number;
  next: ScheduleBlock;
};

/** The block in charge at `now`, with its start and the next boundary. */
export function activeBlockAt(schedule: ThemeSchedule, now: number, timeZone: string): ActiveBlock | null {
  const today = dayIn(now, timeZone);
  const list = boundaries(schedule, addDays(today, -1), addDays(today, 1), timeZone);
  let current: Boundary | null = null;
  let next: Boundary | null = null;
  for (const boundary of list) {
    if (boundary.at <= now) current = boundary;
    else if (!next) next = boundary;
  }
  if (!current || !next) return null;
  return { block: current.block, startedAt: current.at, endsAt: next.at, next: next.block };
}

// --- what is shown ------------------------------------------------------------

export type AppearanceSettings = {
  theme: string;
  custom_theme_id: string | null;
  theme_schedule: unknown;
  theme_override_until: string | null;
  timezone: string;
};

export type ResolvedRef =
  | { ref: ThemeRef; source: "manual"; until: number | null }
  | { ref: ThemeRef; source: "schedule"; active: ActiveBlock };

/**
 * The theme in charge now: the manual pick, unless the schedule is on; then
 * the block's theme, except while a manual change made during the block
 * still holds (until the next block begins).
 */
export function resolveRef(settings: AppearanceSettings, now: number): ResolvedRef {
  const schedule = parseThemeSchedule(settings.theme_schedule);
  const manual = manualRef(settings);
  if (!schedule?.enabled) return { ref: manual, source: "manual", until: null };
  const active = activeBlockAt(schedule, now, settings.timezone);
  if (!active) return { ref: manual, source: "manual", until: null };
  const until = settings.theme_override_until ? Date.parse(settings.theme_override_until) : Number.NaN;
  if (Number.isFinite(until) && until > now) return { ref: manual, source: "manual", until };
  return { ref: active.block.theme, source: "schedule", active };
}

/**
 * The settings patch of a theme picked by hand: with the schedule on it
 * holds until the next block begins, otherwise for good.
 */
export function manualPickPatch(
  ref: ThemeRef,
  settings: AppearanceSettings,
  now: number,
): { theme: ThemeKey; custom_theme_id: string | null; theme_override_until: string | null } {
  const schedule = parseThemeSchedule(settings.theme_schedule);
  const active = schedule?.enabled ? activeBlockAt(schedule, now, settings.timezone) : null;
  return {
    ...manualColumns(ref, settings),
    theme_override_until: active ? new Date(active.endsAt).toISOString() : null,
  };
}

// --- editing ------------------------------------------------------------------

export type BlockSuggestion = { name: string; start: number; theme: ThemeRef };

/**
 * The first schedule offered: morning, afternoon, evening at 6:00, 12:00 and
 * 18:00, morning light and evening Midnight when those are open, the rest the
 * current theme.
 */
export function suggestedBlocks(
  names: { morning: string; afternoon: string; evening: string },
  current: ThemeRef,
  available: (theme: ThemeKey) => boolean,
): BlockSuggestion[] {
  const pick = (theme: ThemeKey) => (available(theme) ? theme : current);
  return [
    { name: names.morning, start: 6 * 60, theme: pick("light") },
    { name: names.afternoon, start: 12 * 60, theme: current },
    { name: names.evening, start: 18 * 60, theme: pick("midnight") },
  ];
}

let counter = 0;
/** A short id for a new block (unique within a day's list). */
export function newBlockId(): string {
  counter += 1;
  return `b${Date.now().toString(36)}${counter.toString(36)}`;
}

export function scheduleFromSuggestions(suggestions: BlockSuggestion[], mode: ScheduleMode = "same"): ThemeSchedule {
  const list = suggestions.map((s) => ({ id: newBlockId(), name: s.name, start: s.start, theme: s.theme, caption: null }));
  const days: ThemeSchedule["days"] = {};
  for (const key of dayKeysOf(mode)) days[key] = list.map((block) => ({ ...block }));
  return { v: 1, enabled: true, mode, days };
}

/** Another mode; the new day lists start as copies of what the old mode had for those days. */
export function switchMode(schedule: ThemeSchedule, mode: ScheduleMode): ThemeSchedule {
  if (mode === schedule.mode) return schedule;
  const days: ThemeSchedule["days"] = {};
  const representative: Record<DayKey, number> = {
    all: 1,
    weekdays: 1,
    weekend: 6,
    "0": 0,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
  };
  for (const key of dayKeysOf(mode)) {
    days[key] = blocksOn(schedule, representative[key]).map((block) => ({ ...block }));
  }
  return { ...schedule, mode, days };
}

/** Copies one day's list over others. */
export function copyDay(schedule: ThemeSchedule, from: DayKey, to: DayKey[]): ThemeSchedule {
  const source = schedule.days[from];
  if (!source) return schedule;
  const days = { ...schedule.days };
  for (const key of to) if (key !== from && key in days) days[key] = source.map((block) => ({ ...block }));
  return { ...schedule, days };
}

/** Sorted by start, so a typed time puts the block in its place. */
export function sortBlocks(blocks: ScheduleBlock[]): ScheduleBlock[] {
  return [...blocks].sort((a, b) => a.start - b.start);
}

/**
 * Dragging the start of block `index` on the timeline: snapped to 15
 * minutes, never onto or past a neighbour (a quarter of an hour stays
 * between), the first block never before midnight.
 */
export function moveStart(blocks: ScheduleBlock[], index: number, minute: number, snap = SNAP_MINUTES): ScheduleBlock[] {
  const block = blocks[index];
  if (!block) return blocks;
  const previous = blocks[index - 1];
  const next = blocks[index + 1];
  const min = previous ? previous.start + snap : 0;
  const max = next ? next.start - snap : DAY_MINUTES - snap;
  const snapped = Math.round(minute / snap) * snap;
  const start = Math.min(max, Math.max(min, snapped));
  if (start === block.start) return blocks;
  return blocks.map((item, i) => (i === index ? { ...item, start } : item));
}

/**
 * The block to add after `index`: halfway to the next start (or to
 * midnight), when there is room for a quarter of an hour on both sides.
 */
export function insertionStart(blocks: ScheduleBlock[], index: number): number | null {
  const block = blocks[index];
  if (!block) return null;
  const end = blocks[index + 1]?.start ?? DAY_MINUTES;
  const middle = Math.round((block.start + end) / 2 / SNAP_MINUTES) * SNAP_MINUTES;
  return middle - block.start >= SNAP_MINUTES && end - middle >= SNAP_MINUTES ? middle : null;
}

/** The refs of custom themes that no longer exist become the default theme. */
export function withoutMissingThemes(schedule: ThemeSchedule, customIds: ReadonlySet<string>): ThemeSchedule {
  const days: ThemeSchedule["days"] = {};
  let changed = false;
  for (const [key, list] of Object.entries(schedule.days) as Array<[DayKey, ScheduleBlock[]]>) {
    days[key] = list.map((block) => {
      const parsed = parseThemeRef(block.theme);
      if (parsed?.kind === "custom" && !customIds.has(parsed.id)) {
        changed = true;
        return { ...block, theme: DEFAULT_THEME };
      }
      return block;
    });
  }
  return changed ? { ...schedule, days } : schedule;
}

/** Every theme a schedule uses, for checks (locked themes) and loading custom ones. */
export function scheduleRefs(schedule: ThemeSchedule): ThemeRef[] {
  const refs = new Set<ThemeRef>();
  for (const list of Object.values(schedule.days)) for (const block of list ?? []) refs.add(block.theme);
  return [...refs];
}

// --- the time of day ----------------------------------------------------------

export const DAY_PERIODS = ["morning", "afternoon", "evening", "night"] as const;
export type DayPeriod = (typeof DAY_PERIODS)[number];

/** Morning 4–12, afternoon 12–17, evening 17–22, night 22–4: the transition's tone and character. */
export function periodOf(minute: number): DayPeriod {
  const hour = Math.floor(minute / 60) % 24;
  if (hour >= 4 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}
