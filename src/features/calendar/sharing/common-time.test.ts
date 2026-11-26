import { describe, expect, it } from "vitest";
import {
  findCommonWindows,
  isWorkingDay,
  mergeIntervals,
  nextDays,
  splitBusy,
  startsInWindow,
} from "./common-time";
import {
  atLeast,
  calendarOwnerOf,
  defaultPersonTone,
  editPath,
  levelRank,
  PERSON_TONES,
  requestableLevels,
  toVisiblePeople,
} from "./levels";

const TZ = "Europe/Prague";
// Monday 7 December 2026; Prague is UTC+1 in winter.
const MONDAY = "2026-12-07";
const at = (iso: string) => Date.parse(iso);
const base = {
  timeZone: TZ,
  workStart: "08:00",
  workEnd: "17:30",
  durationMin: 60,
  nowMs: at("2026-12-01T00:00:00Z"),
};

describe("findCommonWindows", () => {
  it("gives the whole working day when nobody is busy", () => {
    expect(findCommonWindows({ ...base, days: [MONDAY], busy: [] })).toEqual([
      { day: MONDAY, startMs: at("2026-12-07T07:00:00Z"), endMs: at("2026-12-07T16:30:00Z") },
    ]);
  });

  it("leaves out everyone's busy times together", () => {
    const windows = findCommonWindows({
      ...base,
      days: [MONDAY],
      busy: [
        { personId: "a", startMs: at("2026-12-07T08:00:00Z"), endMs: at("2026-12-07T09:00:00Z") },
        { personId: "b", startMs: at("2026-12-07T08:30:00Z"), endMs: at("2026-12-07T10:10:00Z") },
        { personId: "a", startMs: at("2026-12-07T13:00:00Z"), endMs: at("2026-12-07T15:45:00Z") },
      ],
    });
    // 8:00–9:00 free; busy 9:00–11:10 → next start on the grid 11:15; then 14:00–16:45 busy.
    expect(
      windows.map((w) => [new Date(w.startMs).toISOString(), new Date(w.endMs).toISOString()]),
    ).toEqual([
      ["2026-12-07T07:00:00.000Z", "2026-12-07T08:00:00.000Z"],
      ["2026-12-07T10:15:00.000Z", "2026-12-07T13:00:00.000Z"],
    ]);
  });

  it("keeps only windows long enough for the meeting", () => {
    const windows = findCommonWindows({
      ...base,
      durationMin: 90,
      days: [MONDAY],
      busy: [
        { personId: "a", startMs: at("2026-12-07T08:00:00Z"), endMs: at("2026-12-07T15:30:00Z") },
      ],
    });
    // 8:00–9:00 (60 min) is too short, 16:30–17:30 too.
    expect(windows).toEqual([]);
  });

  it("skips weekends, Czech holidays and the past", () => {
    expect(isWorkingDay("2026-12-05", TZ, "CZ")).toBe(false);
    expect(isWorkingDay("2026-12-24", TZ, "CZ")).toBe(false);
    expect(isWorkingDay("2026-12-23", TZ, "CZ")).toBe(true);
    const windows = findCommonWindows({
      ...base,
      days: ["2026-12-05", "2026-12-24", MONDAY],
      country: "CZ",
      busy: [],
      nowMs: at("2026-12-07T09:07:00Z"),
    });
    // 10:07 local rounds up to 10:15.
    expect(windows).toEqual([
      { day: MONDAY, startMs: at("2026-12-07T09:15:00Z"), endMs: at("2026-12-07T16:30:00Z") },
    ]);
  });

  it("ignores all-day busy times", () => {
    const windows = findCommonWindows({
      ...base,
      days: [MONDAY],
      busy: [
        {
          personId: "a",
          startMs: at("2026-12-06T23:00:00Z"),
          endMs: at("2026-12-07T23:00:00Z"),
          allDay: true,
        },
      ],
    });
    expect(windows).toHaveLength(1);
  });

  it("follows the viewer's zone across a DST change", () => {
    // Tuesday 30 March 2027, after the change (the Monday is Easter Monday); Prague is UTC+2.
    const windows = findCommonWindows({ ...base, days: ["2027-03-30"], busy: [] });
    expect(new Date(windows[0].startMs).toISOString()).toBe("2027-03-30T06:00:00.000Z");
  });
});

describe("helpers", () => {
  it("merges overlapping intervals", () => {
    expect(
      mergeIntervals([
        { startMs: 5, endMs: 10 },
        { startMs: 0, endMs: 6 },
        { startMs: 12, endMs: 12 },
        { startMs: 11, endMs: 13 },
      ]),
    ).toEqual([
      { startMs: 0, endMs: 10 },
      { startMs: 11, endMs: 13 },
    ]);
  });

  it("offers the starts inside a window", () => {
    const window = {
      day: MONDAY,
      startMs: at("2026-12-07T07:00:00Z"),
      endMs: at("2026-12-07T08:30:00Z"),
    };
    expect(
      startsInWindow(window, 60, 15).map((ms) => new Date(ms).toISOString().slice(11, 16)),
    ).toEqual(["07:00", "07:15", "07:30"]);
  });

  it("splits what we know from who shares nothing", () => {
    expect(
      splitBusy([
        {
          person_id: "a",
          known: true,
          starts_at: "2026-12-07T08:00:00Z",
          ends_at: "2026-12-07T09:00:00Z",
          all_day: false,
        },
        { person_id: "b", known: false, starts_at: null, ends_at: null, all_day: false },
      ]),
    ).toEqual({
      busy: [
        {
          personId: "a",
          startMs: at("2026-12-07T08:00:00Z"),
          endMs: at("2026-12-07T09:00:00Z"),
          allDay: false,
        },
      ],
      unknown: ["b"],
    });
  });

  it("counts days on", () => {
    expect(nextDays("2026-12-30", 3)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });
});

describe("levels", () => {
  it("orders the levels like the database", () => {
    expect([
      levelRank("busy"),
      levelRank("read"),
      levelRank("write"),
      levelRank(null),
      levelRank("x"),
    ]).toEqual([1, 2, 3, 0, 0]);
    expect(atLeast("read", "busy")).toBe(true);
    expect(atLeast("busy", "read")).toBe(false);
    expect(requestableLevels("busy")).toEqual(["read", "write"]);
    expect(requestableLevels(null)).toEqual(["busy", "read", "write"]);
  });

  it("gives a person the same colour every time", () => {
    const tone = defaultPersonTone("2f1c7c1e-9a51-4f2d-9b50-1c2a3b4c5d6e");
    expect(PERSON_TONES).toContain(tone);
    expect(defaultPersonTone("2f1c7c1e-9a51-4f2d-9b50-1c2a3b4c5d6e")).toBe(tone);
  });

  it("finds whose calendar an event is in", () => {
    expect(calendarOwnerOf({ calendar_owner_id: "v", actor_id: "o", user_id: "s" })).toBe("v");
    expect(calendarOwnerOf({ calendar_owner_id: null, actor_id: "o", user_id: "s" })).toBe("o");
    expect(calendarOwnerOf({ user_id: "s" })).toBe("s");
  });

  it("sends a change through the table first, then the share", () => {
    expect(editPath({ tableEditable: true, sharedEditable: true })).toBe("table");
    expect(editPath({ tableEditable: false, sharedEditable: true })).toBe("share");
    expect(editPath({ tableEditable: false, sharedEditable: false })).toBeNull();
  });

  it("reads the people from the database, dropping odd rows", () => {
    expect(
      toVisiblePeople([
        {
          user_id: "v",
          name: " Váša ",
          avatar_url: null,
          is_owner: false,
          level: "write",
          sources: [
            { key: "gradus", name: null, level: "write" },
            { key: "c1", name: "Práce", level: "busy" },
            { key: 3, level: "read" },
          ],
          can_write: true,
          writes_to: "Práce",
        },
        {
          user_id: "x",
          name: "X",
          avatar_url: null,
          is_owner: false,
          level: "admin",
          sources: [],
          can_write: false,
          writes_to: null,
        },
      ]),
    ).toEqual([
      {
        userId: "v",
        name: "Váša",
        avatarUrl: null,
        isOwner: false,
        level: "write",
        sources: [
          { key: "gradus", name: null, level: "write" },
          { key: "c1", name: "Práce", level: "busy" },
        ],
        canWrite: true,
        writesTo: "Práce",
      },
    ]);
  });
});

describe("shared items", async () => {
  const { personLooks, sharedItems, ownEventLook } = await import("./items");
  const { toEventItem } = await import("../calendar-logic");
  const looks = personLooks(
    [
      { userId: "v", name: "Václav Novák" },
      { userId: "h", name: "Hana" },
    ],
    new Map([
      ["v", { tone: "gold", hidden: false }],
      ["h", { tone: "pink", hidden: true }],
    ]),
  );
  const row = {
    id: "e1",
    personId: "v",
    level: "busy" as const,
    busyOnly: true,
    startsAt: "2026-12-07T08:00:00Z",
    endsAt: "2026-12-07T09:00:00Z",
    allDay: false,
    title: null,
    description: null,
    location: null,
    kind: null,
    source: null,
    createdBy: null,
    createdByName: null,
    canEdit: false,
    inviteStatus: null,
  };

  it("draws busy-only times as the person's hatched blocks with their initials", () => {
    const [item] = sharedItems([row], looks, new Set(), TZ, "Obsazeno");
    expect(item).toMatchObject({
      type: "busy",
      title: "Obsazeno",
      tone: "gold",
      person: { initials: "VN" },
    });
  });

  it("shows read events in full, drops hidden people, own ids and declined invites", () => {
    const items = sharedItems(
      [
        { ...row, id: "e2", level: "read", busyOnly: false, title: "Demo", kind: "meeting" },
        { ...row, id: "e3", personId: "h", level: "read", busyOnly: false, title: "Skryté" },
        { ...row, id: "e4" },
        {
          ...row,
          id: "e5",
          level: "invite",
          busyOnly: false,
          title: "Porada",
          inviteStatus: "declined",
        },
        {
          ...row,
          id: "e6",
          level: "invite",
          busyOnly: false,
          title: "Porada",
          inviteStatus: "invited",
        },
      ],
      looks,
      new Set(["e4"]),
      TZ,
      "Obsazeno",
    );
    expect(items.map((item) => [item.key, item.title])).toEqual([
      ["shared:e2", "Demo"],
      ["invite:e6", "Porada"],
    ]);
    expect(items[0]).toMatchObject({ type: "event", tone: "gold" });
  });

  it("colours the account's own events of someone else's calendar", () => {
    const base = {
      id: "x",
      title: "Schůzka",
      description: null,
      kind: "meeting" as const,
      starts_at: "2026-12-07T08:00:00Z",
      ends_at: "2026-12-07T09:00:00Z",
      all_day: false,
      contact_id: null,
      deal_id: null,
      source: "manual",
      actor_id: "me",
      contact: null,
      deal: null,
    };
    const mine = toEventItem({ ...base, calendar_owner_id: "me" }, TZ);
    expect(ownEventLook(mine, "me", looks)).toBe(mine);
    expect(
      ownEventLook(toEventItem({ ...base, calendar_owner_id: "v" }, TZ), "me", looks),
    ).toMatchObject({
      tone: "gold",
      person: { id: "v" },
    });
    expect(
      ownEventLook(toEventItem({ ...base, calendar_owner_id: "h" }, TZ), "me", looks),
    ).toBeNull();
  });
});
