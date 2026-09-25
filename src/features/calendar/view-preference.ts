import { DEFAULT_VIEW } from "./calendar-logic";
import { CALENDAR_VIEWS, type CalendarView, type MirrorPrefs } from "./types";

/** Per-viewer conveniences only; the calendar works without them. */
const VIEW_KEY = "gradus.calendar.view";
const MIRRORS_KEY = "gradus.calendar.mirrors";

export const DEFAULT_MIRRORS: MirrorPrefs = { tasks: true, deals: true };

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
