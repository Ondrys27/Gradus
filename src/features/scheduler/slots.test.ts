import { describe, expect, it } from "vitest";
import {
  activeBookings,
  availabilityIntervals,
  computeSlots,
  mergeIntervals,
  rulesFor,
  slotsByGuestDay,
  type SlotInput,
  type SlotType,
} from "./slots";
import { addDays, dayIn, instantOf, minutesOfTime, wallExists, wallOf, weekdayOf } from "./zoned";

const PRAGUE = "Europe/Prague";
const utc = (iso: string) => Date.parse(iso);
const at = (value: number | string) => new Date(value).toISOString();

const TYPE: SlotType = {
  durationMin: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  minNoticeHours: 0,
  maxDaysAhead: 14,
  maxPerDay: null,
  slotStepMin: 30,
};

/** Monday 9–12 in Prague; "now" a Sunday evening before. */
function input(overrides: Partial<SlotInput> = {}): SlotInput {
  return {
    hostTimeZone: PRAGUE,
    rules: [{ weekday: 1, start_time: "09:00", end_time: "12:00" }],
    overrides: [],
    busy: [],
    bookings: [],
    type: TYPE,
    // Sunday 15 November 2026, 20:00 in Prague (CET, UTC+1).
    now: utc("2026-11-15T19:00:00Z"),
    from: "2026-11-16",
    to: "2026-11-16",
    ...overrides,
  };
}

function times(slots: ReturnType<typeof computeSlots>, zone = PRAGUE) {
  return slots.map((slot) => {
    const wall = wallOf(slot.start, zone);
    return `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
  });
}

describe("zoned", () => {
  it("reads and writes wall clocks without the machine's zone", () => {
    expect(wallOf(utc("2026-11-16T08:00:00Z"), PRAGUE)).toEqual({
      year: 2026,
      month: 11,
      day: 16,
      hour: 9,
      minute: 0,
    });
    expect(at(instantOf({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, PRAGUE))).toBe(
      "2026-07-01T07:00:00.000Z",
    );
    expect(dayIn(utc("2026-11-16T23:30:00Z"), PRAGUE)).toBe("2026-11-17");
    expect(weekdayOf("2026-11-16")).toBe(1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(minutesOfTime("24:00")).toBe(1440);
    expect(minutesOfTime("09:30:00")).toBe(570);
    expect(minutesOfTime("25:00")).toBeNaN();
  });

  it("a time skipped in spring lands just after the jump; a doubled one in autumn is the first", () => {
    const skipped = { year: 2026, month: 3, day: 29, hour: 2, minute: 30 };
    expect(wallExists(skipped, PRAGUE)).toBe(false);
    expect(at(instantOf(skipped, PRAGUE))).toBe("2026-03-29T01:30:00.000Z"); // 03:30 CEST
    const doubled = { year: 2026, month: 10, day: 25, hour: 2, minute: 30 };
    expect(wallExists(doubled, PRAGUE)).toBe(true);
    expect(at(instantOf(doubled, PRAGUE))).toBe("2026-10-25T00:30:00.000Z"); // 02:30 CEST
  });
});

describe("computeSlots", () => {
  it("cuts the working hours into slots of the step", () => {
    expect(times(computeSlots(input()))).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
      "11:00",
      "11:30",
    ]);
    // A 45-minute meeting every 30 minutes fits until 11:00.
    expect(times(computeSlots(input({ type: { ...TYPE, durationMin: 45 } })))).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
      "11:00",
    ]);
    // Several intervals a day.
    const split = computeSlots(
      input({
        rules: [
          { weekday: 1, start_time: "09:00", end_time: "10:00" },
          { weekday: 1, start_time: "14:00", end_time: "15:00" },
        ],
        type: { ...TYPE, slotStepMin: 60, durationMin: 60 },
      }),
    );
    expect(times(split)).toEqual(["09:00", "14:00"]);
  });

  it("keeps the buffers before and after what is busy", () => {
    const busy = [{ start: utc("2026-11-16T09:00:00Z"), end: utc("2026-11-16T09:30:00Z") }]; // 10:00–10:30
    expect(times(computeSlots(input({ busy })))).toEqual([
      "09:00",
      "09:30",
      "10:30",
      "11:00",
      "11:30",
    ]);
    const padded = computeSlots(
      input({ busy, type: { ...TYPE, bufferBeforeMin: 15, bufferAfterMin: 15 } }),
    );
    // 09:30–10:00 needs 15 minutes after it; 10:30–11:00 15 minutes before it.
    expect(times(padded)).toEqual(["09:00", "11:00", "11:30"]);
  });

  it("bookings block the time; only the same type counts toward the day's maximum", () => {
    const booking = { start: utc("2026-11-16T08:00:00Z"), end: utc("2026-11-16T08:30:00Z") }; // 09:00
    const other = computeSlots(
      input({ bookings: [{ ...booking, sameType: false }], type: { ...TYPE, maxPerDay: 1 } }),
    );
    expect(times(other)).toEqual(["09:30", "10:00", "10:30", "11:00", "11:30"]);
    const same = computeSlots(
      input({ bookings: [{ ...booking, sameType: true }], type: { ...TYPE, maxPerDay: 1 } }),
    );
    expect(same).toEqual([]);
    const two = computeSlots(
      input({ bookings: [{ ...booking, sameType: true }], type: { ...TYPE, maxPerDay: 2 } }),
    );
    expect(two).toHaveLength(5);
  });

  it("respects the minimum notice and how far ahead", () => {
    // Monday 08:00 in Prague, two hours' notice: from 10:00.
    const notice = computeSlots(
      input({ now: utc("2026-11-16T07:00:00Z"), type: { ...TYPE, minNoticeHours: 2 } }),
    );
    expect(times(notice)[0]).toBe("10:00");
    // Already past: nothing on the day.
    expect(computeSlots(input({ now: utc("2026-11-16T12:00:00Z") }))).toEqual([]);
    // One day ahead from Sunday: Monday yes, the Monday after no.
    const ahead = computeSlots(
      input({ from: undefined, to: undefined, type: { ...TYPE, maxDaysAhead: 1 } }),
    );
    expect(new Set(ahead.map((slot) => slot.hostDay))).toEqual(new Set(["2026-11-16"]));
    const twoWeeks = computeSlots(input({ from: undefined, to: undefined }));
    expect(new Set(twoWeeks.map((slot) => slot.hostDay))).toEqual(
      new Set(["2026-11-16", "2026-11-23"]),
    );
    // Never past the horizon, whatever the caller asks.
    expect(computeSlots(input({ from: "2026-11-30", to: "2026-11-30" }))).toEqual([]);
  });

  it("an exception replaces the week's hours; a blocked day has none", () => {
    expect(
      computeSlots(
        input({ overrides: [{ date: "2026-11-16", start_time: null, end_time: null }] }),
      ),
    ).toEqual([]);
    const other = computeSlots(
      input({ overrides: [{ date: "2026-11-16", start_time: "13:00", end_time: "14:00" }] }),
    );
    expect(times(other)).toEqual(["13:00", "13:30"]);
    // An exception on a day without rules opens it.
    const saturday = computeSlots(
      input({
        from: "2026-11-21",
        to: "2026-11-21",
        overrides: [{ date: "2026-11-21", start_time: "10:00", end_time: "11:00" }],
      }),
    );
    expect(times(saturday)).toEqual(["10:00", "10:30"]);
  });

  it("a subscribed calendar's all-day busy time blocks the day", () => {
    const busy = [{ start: utc("2026-11-15T23:00:00Z"), end: utc("2026-11-16T23:00:00Z") }];
    expect(computeSlots(input({ busy }))).toEqual([]);
  });

  it("spring DST: 9:00 stays 9:00, the skipped hour has no slot, every slot is as long as the meeting", () => {
    // Friday 27 March (CET) and Monday 30 March 2026 (CEST).
    const week = computeSlots({
      ...input(),
      rules: [
        { weekday: 5, start_time: "09:00", end_time: "09:30" },
        { weekday: 1, start_time: "09:00", end_time: "09:30" },
      ],
      now: utc("2026-03-26T12:00:00Z"),
      from: "2026-03-27",
      to: "2026-03-30",
    });
    expect(week.map((slot) => at(slot.start))).toEqual([
      "2026-03-27T08:00:00.000Z",
      "2026-03-30T07:00:00.000Z",
    ]);
    // The night of the change: 02:00 does not exist.
    const night = computeSlots({
      ...input(),
      rules: [{ weekday: 0, start_time: "00:00", end_time: "06:00" }],
      type: { ...TYPE, durationMin: 60, slotStepMin: 60 },
      now: utc("2026-03-28T12:00:00Z"),
      from: "2026-03-29",
      to: "2026-03-29",
    });
    expect(times(night)).toEqual(["00:00", "01:00", "03:00", "04:00", "05:00"]);
    for (const slot of night) expect(slot.end - slot.start).toBe(3_600_000);
  });

  it("autumn DST: the doubled hour gives one slot, the day still ends at its midnight", () => {
    const night = computeSlots({
      ...input(),
      rules: [{ weekday: 0, start_time: "00:00", end_time: "04:00" }],
      type: { ...TYPE, durationMin: 60, slotStepMin: 60 },
      now: utc("2026-10-24T12:00:00Z"),
      from: "2026-10-25",
      to: "2026-10-25",
    });
    expect(times(night)).toEqual(["00:00", "01:00", "02:00", "03:00"]);
    expect(new Set(night.map((slot) => slot.start)).size).toBe(4);
  });

  it("midnight: hours until 24:00 join the next day's, a slot may run across", () => {
    const late = computeSlots({
      ...input(),
      rules: [
        { weekday: 5, start_time: "22:00", end_time: "24:00" },
        { weekday: 6, start_time: "00:00", end_time: "01:00" },
      ],
      type: { ...TYPE, durationMin: 60, slotStepMin: 30 },
      now: utc("2026-11-19T12:00:00Z"),
      from: "2026-11-20",
      to: "2026-11-21",
    });
    expect(late.map((slot) => `${slot.hostDay} ${times([slot])[0]}`)).toEqual([
      "2026-11-20 22:00",
      "2026-11-20 22:30",
      "2026-11-20 23:00",
      "2026-11-20 23:30",
      "2026-11-21 00:00",
    ]);
    // Without Saturday's hour the last one ending at midnight is 23:00.
    const alone = computeSlots({
      ...input(),
      rules: [{ weekday: 5, start_time: "22:00", end_time: "24:00" }],
      type: { ...TYPE, durationMin: 60, slotStepMin: 30 },
      now: utc("2026-11-19T12:00:00Z"),
      from: "2026-11-20",
      to: "2026-11-20",
    });
    expect(times(alone)).toEqual(["22:00", "22:30", "23:00"]);
  });

  it("works for a host far from Prague", () => {
    const tokyo = computeSlots({
      ...input(),
      hostTimeZone: "Asia/Tokyo",
      now: utc("2026-11-15T00:00:00Z"),
    });
    expect(at(tokyo[0].start)).toBe("2026-11-16T00:00:00.000Z"); // 09:00 in Tokyo
  });
});

describe("slotsByGuestDay", () => {
  it("reads the host's slots in the guest's zone and day", () => {
    const slots = computeSlots(input());
    const ny = slotsByGuestDay(slots, "America/New_York");
    expect(ny).toHaveLength(1);
    expect(ny[0].day).toBe("2026-11-16");
    expect(ny[0].slots.map((slot) => slot.time)).toEqual([
      "03:00",
      "03:30",
      "04:00",
      "04:30",
      "05:00",
      "05:30",
    ]);
    // Late in Prague is the next day in Tokyo.
    const late = computeSlots({
      ...input(),
      rules: [{ weekday: 1, start_time: "15:30", end_time: "16:30" }],
    });
    const tokyo = slotsByGuestDay(late, "Asia/Tokyo");
    expect(tokyo.map((day) => [day.day, day.slots.map((slot) => slot.time)])).toEqual([
      ["2026-11-16", ["23:30"]],
      ["2026-11-17", ["00:00"]],
    ]);
  });
});

describe("helpers", () => {
  it("merges overlapping and touching intervals", () => {
    expect(
      mergeIntervals([
        { start: 5, end: 7 },
        { start: 1, end: 3 },
        { start: 3, end: 4 },
        { start: 6, end: 9 },
        { start: 10, end: 10 },
      ]),
    ).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 9 },
    ]);
  });

  it("builds the hours of a range of days", () => {
    const hours = availabilityIntervals(
      [{ weekday: 1, start_time: "09:00:00", end_time: "17:00:00" }],
      [],
      "2026-11-16",
      "2026-11-22",
      PRAGUE,
    );
    expect(hours).toEqual([
      { start: utc("2026-11-16T08:00:00Z"), end: utc("2026-11-16T16:00:00Z") },
    ]);
  });

  it("holds count only until they expire", () => {
    const now = utc("2026-11-16T10:00:00Z");
    const base = { starts_at: "2026-11-17T08:00:00Z", ends_at: "2026-11-17T08:30:00Z" };
    const list = [
      { ...base, status: "held", hold_expires_at: "2026-11-16T10:03:00Z" },
      { ...base, status: "held", hold_expires_at: "2026-11-16T09:59:00Z" },
      { ...base, status: "pending", hold_expires_at: null },
      { ...base, status: "confirmed", hold_expires_at: null },
      { ...base, status: "cancelled", hold_expires_at: null },
      { ...base, status: "declined", hold_expires_at: null },
    ];
    expect(activeBookings(list, now).map((booking) => booking.status)).toEqual([
      "held",
      "pending",
      "confirmed",
    ]);
  });

  it("a type with its own hours uses only those", () => {
    const rules = [
      { weekday: 1, start_time: "09:00", end_time: "17:00", event_type_id: null },
      { weekday: 2, start_time: "10:00", end_time: "12:00", event_type_id: "t1" },
    ];
    expect(rulesFor(rules, { id: "t1", custom_availability: false })).toHaveLength(1);
    expect(rulesFor(rules, { id: "t1", custom_availability: true })[0].weekday).toBe(2);
  });
});
