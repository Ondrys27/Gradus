import { DEFAULT_VIEW } from "./calendar-logic";
import { CALENDAR_VIEWS, type CalendarView, type MirrorPrefs } from "./types";

/** Per-viewer conveniences only; the calendar works without them. */
const VIEW_KEY = "gradus.calendar.view";
const MIRRORS_KEY = "gradus.calendar.mirrors";

export const DEFAULT_MIRRORS: MirrorPrefs = {
  tasks: true,
  deals: true,
  crmTasks: true,
  subscriptions: true,
};

export function parseView(value: string | null): CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as CalendarView)
    : DEFAULT_VIEW;
}

export function parseMirrors(value: string | null): MirrorPrefs {
  try {
    const parsed = JSON.parse(value ?? "null") as Partial<MirrorPrefs> | null;
    return {
      tasks: typeof parsed?.tasks === "boolean" ? parsed.tasks : DEFAULT_MIRRORS.tasks,
      deals: typeof parsed?.deals === "boolean" ? parsed.deals : DEFAULT_MIRRORS.deals,
      crmTasks: typeof parsed?.crmTasks === "boolean" ? parsed.crmTasks : DEFAULT_MIRRORS.crmTasks,
      subscriptions:
        typeof parsed?.subscriptions === "boolean"
          ? parsed.subscriptions
          : DEFAULT_MIRRORS.subscriptions,
    };
  } catch {
    return DEFAULT_MIRRORS;
  }
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked; the choice then lasts until the page is closed.
  }
}

export function loadView(): CalendarView {
  return parseView(read(VIEW_KEY));
}
export function saveView(view: CalendarView) {
  write(VIEW_KEY, view);
}
export function loadMirrors(): MirrorPrefs {
  return parseMirrors(read(MIRRORS_KEY));
}
export function saveMirrors(prefs: MirrorPrefs) {
  write(MIRRORS_KEY, JSON.stringify(prefs));
}

const SOURCES_KEY = "gradus.calendar.sources";

/** The checkbox and colour of each of the account's own sources (30.3), kept in the browser. */
export type SourcePrefs = Record<string, { hidden: boolean; tone: SourceTone | null }>;
type SourceTone = "teal" | "gold" | "green" | "pink" | "violet";
const SOURCE_TONES = new Set(["teal", "gold", "green", "pink", "violet"]);

export function parseSourcePrefs(value: string | null): SourcePrefs {
  try {
    const parsed = JSON.parse(value ?? "null") as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: SourcePrefs = {};
    for (const [key, entry] of Object.entries(parsed).slice(0, 50)) {
      if (!entry || typeof entry !== "object") continue;
      const { hidden, tone } = entry as Record<string, unknown>;
      out[key] = {
        hidden: hidden === true,
        tone: typeof tone === "string" && SOURCE_TONES.has(tone) ? (tone as SourceTone) : null,
      };
    }
    return out;
  } catch {
    return {};
  }
}
export function loadSourcePrefs(): SourcePrefs {
  return parseSourcePrefs(read(SOURCES_KEY));
}
export function saveSourcePrefs(prefs: SourcePrefs) {
  write(SOURCES_KEY, JSON.stringify(prefs));
}
