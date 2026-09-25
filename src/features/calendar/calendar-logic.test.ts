import { describe, expect, it } from "vitest";
import {
  dayRangeToInstants,
  dotsForDay,
  eventKind,
  itemsByDay,
  layoutDay,
  movedRange,
  rangeFromDrag,
  resizedRange,
  shiftCursor,
  snapMinutes,
  toEventItem,
  toMirrorItem,
  viewDays,
} from "./calendar-logic";
import type { CalendarEvent } from "./types";
import { parseMirrors, parseView } from "./view-preference";

const PRAGUE = "Europe/Prague";

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "e1",
    title: "Call",
    description: null,
    kind: "meeting",
    starts_at: "2026-09-25T08:00:00.000Z", // 10:00 in Prague (summer time)
    ends_at: "2026-09-25T09:00:00.000Z",
    all_day: false,
    contact_id: null,
    deal_id: null,
    source: "manual",
    contact: null,
    deal: null,
    ...overrides,
  };
}

describe("viewDays", () => {
  it("covers whole weeks for a month, starting on the chosen weekday", () => {
    const monday = viewDays("month", "2026-09-15", 1);
    expect(monday[0]).toBe("2026-08-31");
    expect(monday.at(-1)).toBe("2026-10-04");
    expect(monday).toHaveLength(35);
    const sunday = viewDays("month", "2026-09-15", 0);
    expect(sunday[0]).toBe("2026-08-30");
    expect(sunday.length % 7).toBe(0);
  });

  it("uses as many rows as the month needs", () => {
    expect(viewDays("month", "2027-02-10", 1)).toHaveLength(28);
    expect(viewDays("month", "2026-11-10", 1)).toHaveLength(42);
    expect(viewDays("month", "2026-08-10", 1)).toHaveLength(42);
  });

  it("gives seven days for a week and one for a day", () => {
    expect(viewDays("week", "2026-09-25", 1)).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
    expect(viewDays("week", "2026-09-27", 0)[0]).toBe("2026-09-27");
    expect(viewDays("day", "2026-09-25", 1)).toEqual(["2026-09-25"]);
  });
});

describe("shiftCursor", () => {
  it("moves by a day, a week or a month", () => {
    expect(shiftCursor("day", "2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftCursor("week", "2026-09-30", -1)).toBe("2026-09-23");
    expect(shiftCursor("month", "2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("dayRangeToInstants", () => {
  it("bounds days in the user's zone, not in UTC", () => {
    expect(dayRangeToInstants("2026-09-25", "2026-09-25", PRAGUE)).toEqual({
      from: "2026-09-24T22:00:00.000Z",
      to: "2026-09-25T22:00:00.000Z",
    });
  });
  it("follows the clock change", () => {
    const range = dayRangeToInstants("2026-10-25", "2026-10-25", PRAGUE);
    expect(range.from).toBe("2026-10-24T22:00:00.000Z");
    expect(range.to).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("eventKind", () => {
  it("maps the older types onto the three shown", () => {
    expect(eventKind("call")).toBe("meeting");
    expect(eventKind("reminder")).toBe("deadline");
    expect(eventKind("other")).toBe("deadline");
    expect(eventKind("task")).toBe("task");
  });
});

describe("toEventItem", () => {
  it("puts a late evening event on the user's day, not the UTC day", () => {
    const item = toEventItem(
      event({ starts_at: "2026-09-25T22:30:00.000Z", ends_at: "2026-09-25T23:00:00.000Z" }),
      PRAGUE,
    );
    expect(item.firstDay).toBe("2026-09-26");
    expect(item.lastDay).toBe("2026-09-26");
  });

  it("does not touch the next day when it ends at midnight", () => {
    const item = toEventItem(
      event({ starts_at: "2026-09-25T20:00:00.000Z", ends_at: "2026-09-25T22:00:00.000Z" }),
      PRAGUE,
    );
    expect(item.lastDay).toBe("2026-09-25");
  });

  it("shows an event without an end as one hour", () => {
    const item = toEventItem(event({ ends_at: null }), PRAGUE);
    expect(item.endMs - item.startMs).toBe(3_600_000);
  });

  it("spans the days of an all-day event", () => {
    const item = toEventItem(
      event({
        all_day: true,
        kind: "deadline",
        starts_at: "2026-09-24T22:00:00.000Z",
        ends_at: "2026-09-26T22:00:00.000Z",
      }),
      PRAGUE,
    );
    expect([item.firstDay, item.lastDay]).toEqual(["2026-09-25", "2026-09-27"]);
    expect(item.tone).toBe("gold");
  });

  it("colours meeting violet, task teal and deadline gold", () => {
    expect(toEventItem(event({ kind: "meeting" }), PRAGUE).tone).toBe("violet");
    expect(toEventItem(event({ kind: "task" }), PRAGUE).tone).toBe("teal");
    expect(toEventItem(event({ kind: "deadline" }), PRAGUE).tone).toBe("gold");
  });
});

describe("itemsByDay", () => {
  it("lists all-day items first, then by start, and repeats multi-day items", () => {
    const early = toEventItem(
      event({ id: "a", starts_at: "2026-09-25T06:00:00.000Z", ends_at: null }),
      PRAGUE,
    );
    const late = toEventItem(
      event({ id: "b", starts_at: "2026-09-25T12:00:00.000Z", ends_at: null }),
      PRAGUE,
    );
    const mirror = toMirrorItem({
      id: "t",
      source: "task",
      title: "Task",
      date: "2026-09-25",
      href: "/x",
    });
    const span = toEventItem(
      event({
        id: "c",
        all_day: true,
        starts_at: "2026-09-24T22:00:00.000Z",
        ends_at: "2026-09-25T22:00:00.000Z",
      }),
      PRAGUE,
    );
    const map = itemsByDay([late, mirror, early, span], ["2026-09-25", "2026-09-26"]);
    expect(map.get("2026-09-25")!.map((item) => item.key)).toEqual([
      "event:c",
      "task:t",
      "event:a",
      "event:b",
    ]);
    expect(map.get("2026-09-26")!.map((item) => item.key)).toEqual(["event:c"]);
  });
});

describe("dotsForDay", () => {
  it("shows at most three dots and a grey one for the rest", () => {
    const items = ["a", "b", "c", "d", "e"].map((id) =>
      toEventItem(event({ id, ends_at: null }), PRAGUE),
    );
    expect(dotsForDay(items.slice(0, 2))).toMatchObject({ more: false });
    expect(dotsForDay(items.slice(0, 3))).toMatchObject({ more: false });
    const many = dotsForDay(items);
    expect(many.tones).toHaveLength(3);
    expect(many.more).toBe(true);
  });
});

describe("layoutDay", () => {
  const at = (id: string, from: string, to: string) =>
    toEventItem(event({ id, starts_at: from, ends_at: to }), PRAGUE);

  it("puts overlapping events side by side and leaves the rest full width", () => {
    const a = at("a", "2026-09-25T08:00:00.000Z", "2026-09-25T09:30:00.000Z"); // 10:00–11:30
    const b = at("b", "2026-09-25T08:30:00.000Z", "2026-09-25T09:00:00.000Z"); // 10:30–11:00
    const c = at("c", "2026-09-25T10:00:00.000Z", "2026-09-25T11:00:00.000Z"); // 12:00–13:00
    const laid = layoutDay([a, b, c], "2026-09-25", PRAGUE);
    const by = Object.fromEntries(laid.map((entry) => [entry.item.event.id, entry]));
    expect(by.a).toMatchObject({ top: 600, height: 90, column: 0, columns: 2 });
    expect(by.b).toMatchObject({ column: 1, columns: 2 });
    expect(by.c).toMatchObject({ top: 720, column: 0, columns: 1 });
  });

  it("clips an event that runs past midnight to the day", () => {
    const night = at("n", "2026-09-25T20:00:00.000Z", "2026-09-26T05:00:00.000Z"); // 22:00–07:00
    const first = layoutDay([night], "2026-09-25", PRAGUE)[0];
    expect([first.top, first.top + first.height]).toEqual([1320, 1440]);
    const second = layoutDay([night], "2026-09-26", PRAGUE)[0];
    expect([second.top, second.top + second.height]).toEqual([0, 420]);
  });

  it("gives a very short event a tappable height", () => {
    const short = at("s", "2026-09-25T08:00:00.000Z", "2026-09-25T08:05:00.000Z");
    expect(layoutDay([short], "2026-09-25", PRAGUE)[0].height).toBe(30);
  });

  it("ignores all-day items", () => {
    const allDay = toEventItem(event({ all_day: true }), PRAGUE);
    expect(layoutDay([allDay], "2026-09-25", PRAGUE)).toEqual([]);
  });
});

describe("dragging", () => {
  it("snaps to quarters of an hour", () => {
    expect(snapMinutes(607)).toBe(600);
    expect(snapMinutes(608)).toBe(615);
    expect(snapMinutes(614, "floor")).toBe(600);
  });

  it("makes a one-hour event from a tap and a range from a drag", () => {
    expect(rangeFromDrag("2026-09-25", 600, 600, PRAGUE)).toEqual({
      starts_at: "2026-09-25T08:00:00.000Z",
      ends_at: "2026-09-25T09:00:00.000Z",
    });
    expect(rangeFromDrag("2026-09-25", 660, 600, PRAGUE)).toEqual({
      starts_at: "2026-09-25T08:00:00.000Z",
      ends_at: "2026-09-25T09:00:00.000Z",
    });
    expect(rangeFromDrag("2026-09-25", 600, 690, PRAGUE).ends_at).toBe("2026-09-25T09:30:00.000Z");
  });

  it("moves an event to another day and time, keeping its length", () => {
    const item = toEventItem(event(), PRAGUE);
    expect(movedRange(item, "2026-09-26", 14 * 60 + 30, PRAGUE)).toEqual({
      starts_at: "2026-09-26T12:30:00.000Z",
      ends_at: "2026-09-26T13:30:00.000Z",
    });
  });

  it("resizes from the end and never below a quarter of an hour", () => {
    const item = toEventItem(event(), PRAGUE);
    expect(resizedRange(item, "2026-09-25", 12 * 60, PRAGUE).ends_at).toBe(
      "2026-09-25T10:00:00.000Z",
    );
    expect(resizedRange(item, "2026-09-25", 9 * 60, PRAGUE).ends_at).toBe(
      "2026-09-25T08:15:00.000Z",
    );
    expect(resizedRange(item, "2026-09-25", 24 * 60, PRAGUE).ends_at).toBe(
      "2026-09-25T22:00:00.000Z",
    );
  });
});

describe("remembered choices", () => {
  it("falls back to the month view and to showing everything", () => {
    expect(parseView(null)).toBe("month");
    expect(parseView("year")).toBe("month");
    expect(parseView("week")).toBe("week");
    expect(parseMirrors(null)).toEqual({ tasks: true, deals: true });
    expect(parseMirrors("nonsense")).toEqual({ tasks: true, deals: true });
    expect(parseMirrors('{"tasks":false}')).toEqual({ tasks: false, deals: true });
  });
});
