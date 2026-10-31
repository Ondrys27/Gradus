import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS, formatRelativeTime, type FormatSettings } from "@/lib/format";
import {
  applyQuickView,
  DEFAULT_FILTERS,
  defaultDueAt,
  delayMinutes,
  dueRange,
  durationBounds,
  filtersToSearch,
  groupOf,
  groupTasks,
  isOverdue,
  ownerTaskPasses,
  parseFilters,
  quickDueAt,
  quickViewOf,
  sortTasks,
  validateTask,
  type TaskTiming,
} from "./logic";

const PRAGUE: FormatSettings = {
  ...DEFAULT_FORMAT_SETTINGS,
  timeZone: "Europe/Prague",
  weekStartsOn: 1,
};
// Wednesday 4 November 2026, 10:00 in Prague (UTC+1).
const NOW = new Date("2026-11-04T09:00:00Z");

let seq = 0;
function task(patch: Partial<TaskTiming>): TaskTiming {
  seq += 1;
  return {
    id: `t${String(seq).padStart(3, "0")}`,
    done: false,
    dueAt: null,
    dueDay: null,
    createdAt: "2026-11-01T08:00:00Z",
    completedAt: null,
    ...patch,
  };
}
/** An instant from a Prague wall clock in November (UTC+1). */
const prague = (day: string, time: string) => new Date(`${day}T${time}:00+01:00`).toISOString();

describe("overdue", () => {
  it("is overdue from the minute after the due time, never before", () => {
    const due = task({ dueAt: prague("2026-11-04", "15:00") });
    expect(isOverdue(due, new Date(prague("2026-11-04", "14:59")), PRAGUE)).toBe(false);
    expect(isOverdue(due, new Date(prague("2026-11-04", "15:00")), PRAGUE)).toBe(false);
    expect(isOverdue(due, new Date(prague("2026-11-04", "15:01")), PRAGUE)).toBe(true);
  });

  it("never calls a done task overdue", () => {
    expect(isOverdue(task({ dueAt: prague("2026-10-01", "09:00"), done: true }), NOW, PRAGUE)).toBe(
      false,
    );
  });

  it("calls a task without a time overdue only the day after its day", () => {
    expect(isOverdue(task({ dueDay: "2026-11-04" }), NOW, PRAGUE)).toBe(false);
    expect(isOverdue(task({ dueDay: "2026-11-03" }), NOW, PRAGUE)).toBe(true);
  });

  it("counts the day in the user's zone, not in UTC", () => {
    // 00:30 in Prague on the 5th is still the 4th in UTC.
    const lateNight = new Date(prague("2026-11-05", "00:30"));
    expect(isOverdue(task({ dueDay: "2026-11-04" }), lateNight, PRAGUE)).toBe(true);
  });
});

describe("groups", () => {
  it("puts every task into its group by the user's day and week", () => {
    const cases: [TaskTiming, string][] = [
      [task({ dueAt: prague("2026-11-04", "09:59") }), "overdue"],
      [task({ dueAt: prague("2026-11-04", "18:00") }), "today"],
      [task({ dueAt: prague("2026-11-05", "09:00") }), "tomorrow"],
      [task({ dueAt: prague("2026-11-08", "23:00") }), "thisWeek"],
      [task({ dueAt: prague("2026-11-09", "08:00") }), "later"],
      [task({ dueDay: "2026-11-04" }), "today"],
      [task({ dueAt: prague("2026-11-01", "09:00"), done: true }), "done"],
    ];
    for (const [item, group] of cases) expect(groupOf(item, NOW, PRAGUE)).toBe(group);
  });

  it("on a Sunday keeps tomorrow as tomorrow, even in the next week", () => {
    const sunday = new Date(prague("2026-11-08", "10:00"));
    expect(groupOf(task({ dueAt: prague("2026-11-09", "09:00") }), sunday, PRAGUE)).toBe(
      "tomorrow",
    );
    expect(groupOf(task({ dueAt: prague("2026-11-10", "09:00") }), sunday, PRAGUE)).toBe("later");
  });

  it("follows the user's week start", () => {
    const sundayStart = { ...PRAGUE, weekStartsOn: 0 as const };
    // With weeks from Sunday, Sunday the 8th is already next week.
    expect(groupOf(task({ dueAt: prague("2026-11-08", "09:00") }), NOW, sundayStart)).toBe("later");
    expect(groupOf(task({ dueAt: prague("2026-11-07", "09:00") }), NOW, sundayStart)).toBe(
      "thisWeek",
    );
  });

  it("lists the groups in order, without empty ones, each sorted", () => {
    const later = task({ dueAt: prague("2026-11-20", "09:00") });
    const overdueOld = task({ dueAt: prague("2026-11-01", "09:00") });
    const overdueNew = task({ dueAt: prague("2026-11-03", "09:00") });
    const doneOld = task({ done: true, completedAt: "2026-11-02T10:00:00Z" });
    const doneNew = task({ done: true, completedAt: "2026-11-03T10:00:00Z" });
    const groups = groupTasks(
      [later, doneOld, overdueNew, doneNew, overdueOld],
      (item) => item,
      NOW,
      PRAGUE,
    );
    expect(groups.map((group) => group.group)).toEqual(["overdue", "later", "done"]);
    expect(groups[0].items).toEqual([overdueOld, overdueNew]);
    expect(groups[2].items).toEqual([doneNew, doneOld]);
  });
});

describe("order", () => {
  it("puts the oldest due first, ties by when the task was made", () => {
    const a = task({ dueAt: prague("2026-11-05", "09:00"), createdAt: "2026-11-02T00:00:00Z" });
    const b = task({ dueAt: prague("2026-11-05", "09:00"), createdAt: "2026-11-01T00:00:00Z" });
    const c = task({ dueAt: prague("2026-11-04", "16:00") });
    expect(sortTasks([a, b, c], (item) => item, PRAGUE.timeZone)).toEqual([c, b, a]);
  });

  it("puts a day without a time after the timed tasks of that day", () => {
    const allDay = task({ dueDay: "2026-11-05" });
    const evening = task({ dueAt: prague("2026-11-05", "22:00") });
    const nextMorning = task({ dueAt: prague("2026-11-06", "07:00") });
    expect(sortTasks([nextMorning, allDay, evening], (item) => item, PRAGUE.timeZone)).toEqual([
      evening,
      allDay,
      nextMorning,
    ]);
  });

  it("keeps open tasks before done ones", () => {
    const done = task({ done: true, completedAt: "2026-11-04T08:00:00Z" });
    const open = task({ dueAt: prague("2026-12-01", "09:00") });
    expect(sortTasks([done, open], (item) => item, PRAGUE.timeZone)).toEqual([open, done]);
  });
});

describe("due moments", () => {
  it("starts a new task at tomorrow 9:00 in the user's zone", () => {
    expect(defaultDueAt(NOW, "Europe/Prague")).toBe("2026-11-05T08:00:00.000Z");
  });

  it("moves the day of the quick choices and keeps the time", () => {
    const at = prague("2026-11-05", "14:30");
    expect(quickDueAt("tomorrow", at, NOW, "Europe/Prague")).toBe(prague("2026-11-05", "14:30"));
    expect(quickDueAt("nextWeek", at, NOW, "Europe/Prague")).toBe(prague("2026-11-11", "14:30"));
    expect(quickDueAt("today", at, NOW, "Europe/Prague")).toBe(prague("2026-11-04", "14:30"));
  });

  it("never makes today's task overdue from the start", () => {
    const morning = prague("2026-11-05", "09:00");
    expect(quickDueAt("today", morning, NOW, "Europe/Prague")).toBe(prague("2026-11-04", "11:00"));
    const lateEvening = new Date(prague("2026-11-04", "23:20"));
    expect(quickDueAt("today", morning, lateEvening, "Europe/Prague")).toBe(
      prague("2026-11-04", "23:45"),
    );
  });

  it("measures the delay of a finished task in minutes, early as negative", () => {
    const due = prague("2026-11-04", "15:00");
    expect(delayMinutes(due, new Date(prague("2026-11-04", "16:30")))).toBe(90);
    expect(delayMinutes(due, new Date(prague("2026-11-04", "14:45")))).toBe(-15);
  });

  it("words the distance to the due time in the interface language", () => {
    expect(formatRelativeTime(new Date(prague("2026-11-04", "13:00")), NOW, "en")).toBe(
      "in 3 hours",
    );
    expect(formatRelativeTime(new Date(prague("2026-11-02", "10:00")), NOW, "cs")).toBe(
      "před 2 dny",
    );
  });
});

describe("filters in the address", () => {
  it("reads what it knows and drops the rest", () => {
    const filters = parseFilters(
      new URLSearchParams(
        "due=today&who=me&status=open&duration=le30&deal=0f4f8b6e-0000-4000-8000-000000000001&x=1",
      ),
    );
    expect(filters).toEqual({
      ...DEFAULT_FILTERS,
      due: "today",
      who: "me",
      status: "open",
      duration: "le30",
      deal: "0f4f8b6e-0000-4000-8000-000000000001",
    });
    expect(parseFilters(new URLSearchParams("due=soon&who=<script>&status=x&deal=1"))).toEqual(
      DEFAULT_FILTERS,
    );
    // A custom range needs at least one day.
    expect(parseFilters(new URLSearchParams("due=custom")).due).toBeNull();
  });

  it("writes only what differs from the defaults and keeps other parameters", () => {
    const filters = {
      ...DEFAULT_FILTERS,
      due: "custom" as const,
      from: "2026-11-01",
      to: "2026-11-10",
    };
    const search = filtersToSearch(filters, new URLSearchParams("task=abc&status=done"));
    expect(search).toBe("?task=abc&due=custom&from=2026-11-01&to=2026-11-10");
    expect(parseFilters(new URLSearchParams(search))).toEqual(filters);
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe("");
  });

  it("maps the quick switches to filters and back", () => {
    expect(quickViewOf(DEFAULT_FILTERS)).toBe("all");
    const overdue = applyQuickView({ ...DEFAULT_FILTERS, who: "me" }, "overdue");
    expect(overdue).toMatchObject({ due: "overdue", status: "open", who: "me" });
    expect(quickViewOf(overdue)).toBe("overdue");
    expect(quickViewOf(applyQuickView(DEFAULT_FILTERS, "today"))).toBe("today");
    expect(quickViewOf({ ...DEFAULT_FILTERS, due: "nextWeek" })).toBeNull();
  });

  it("turns a due filter into instants of the user's days", () => {
    const today = dueRange({ ...DEFAULT_FILTERS, due: "today" }, NOW, PRAGUE);
    expect(today.from?.toISOString()).toBe("2026-11-03T23:00:00.000Z");
    expect(today.to?.toISOString()).toBe("2026-11-04T23:00:00.000Z");
    const week = dueRange({ ...DEFAULT_FILTERS, due: "nextWeek" }, NOW, PRAGUE);
    expect(week.from?.toISOString()).toBe("2026-11-08T23:00:00.000Z");
    expect(week.to?.toISOString()).toBe("2026-11-15T23:00:00.000Z");
    expect(dueRange({ ...DEFAULT_FILTERS, due: "overdue" }, NOW, PRAGUE)).toEqual({
      from: null,
      to: NOW,
    });
    const reversed = dueRange(
      { ...DEFAULT_FILTERS, due: "custom", from: "2026-11-10", to: "2026-11-01" },
      NOW,
      PRAGUE,
    );
    expect(reversed.from?.toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });

  it("treats 'up to' as including the edge", () => {
    expect(durationBounds("le30")).toEqual({ max: 30, over: null });
    expect(durationBounds("gt60")).toEqual({ max: null, over: 60 });
  });

  it("filters the tasks from the owner by day and refuses filters they have nothing for", () => {
    const me = "0f4f8b6e-0000-4000-8000-0000000000aa";
    const today = { dueDay: "2026-11-04", done: false };
    const filters = (patch: Partial<typeof DEFAULT_FILTERS>) => ({ ...DEFAULT_FILTERS, ...patch });
    expect(ownerTaskPasses(today, filters({ due: "today" }), me, NOW, PRAGUE)).toBe(true);
    expect(ownerTaskPasses(today, filters({ due: "overdue" }), me, NOW, PRAGUE)).toBe(false);
    expect(ownerTaskPasses(today, filters({ due: "thisWeek", who: me }), me, NOW, PRAGUE)).toBe(
      true,
    );
    expect(ownerTaskPasses(today, filters({ duration: "le15" }), me, NOW, PRAGUE)).toBe(false);
    expect(ownerTaskPasses(today, filters({ who: "someone-else" }), me, NOW, PRAGUE)).toBe(false);
    expect(
      ownerTaskPasses({ ...today, done: true }, filters({ status: "open" }), me, NOW, PRAGUE),
    ).toBe(false);
  });
});

describe("validation", () => {
  const base = {
    title: "Zavolat",
    description: "",
    due_at: "2026-11-05T08:00:00.000Z",
    duration_minutes: 15,
    assignee_id: null,
    deal_id: "0f4f8b6e-0000-4000-8000-000000000001",
    contact_id: null,
  };

  it("needs only a title when the task already belongs somewhere", () => {
    expect(validateTask(base).ok).toBe(true);
    expect(validateTask({ ...base, title: "  " })).toEqual({
      ok: false,
      errors: { title: "titleRequired" },
    });
  });

  it("needs a deal or a contact, and a sensible length", () => {
    expect(validateTask({ ...base, deal_id: null })).toEqual({
      ok: false,
      errors: { target: "targetRequired" },
    });
    expect(validateTask({ ...base, duration_minutes: 0 })).toMatchObject({
      ok: false,
      errors: { duration_minutes: "durationInvalid" },
    });
  });
});
