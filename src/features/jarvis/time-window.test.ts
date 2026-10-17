import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS, zonedWallClockToInstant } from "@/lib/format";
import type { StatRow } from "@/features/cold-calling/heatmap-logic";
import {
  bestHoursFromStats,
  czechHoliday,
  describeDayPlan,
  describeTimeWindow,
  easterSunday,
  PREP_ACTIVITIES,
  timeWindow,
} from "./time-window";

const PRAGUE = "Europe/Prague";
const at = (date: string, time: string, zone = PRAGUE) => zonedWallClockToInstant(date, time, zone);
const prague = (date: string, time: string, stats?: StatRow[]) =>
  timeWindow({ now: at(date, time), timeZone: PRAGUE, country: "CZ", stats });

describe("holidays", () => {
  it("finds Easter Sunday for any year", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(easterSunday(2038)).toBe("2038-04-25");
  });

  it("knows the fixed and the movable Czech holidays", () => {
    expect(czechHoliday("2026-01-01")).toBe("newYear");
    expect(czechHoliday("2026-04-03")).toBe("goodFriday");
    expect(czechHoliday("2026-04-06")).toBe("easterMonday");
    expect(czechHoliday("2027-03-26")).toBe("goodFriday");
    expect(czechHoliday("2027-03-29")).toBe("easterMonday");
    expect(czechHoliday("2026-10-28")).toBe("independence");
    expect(czechHoliday("2026-11-17")).toBe("freedomDay");
    expect(czechHoliday("2026-12-24")).toBe("christmasEve");
    expect(czechHoliday("2026-10-27")).toBeNull();
    expect(czechHoliday("2026-04-05")).toBeNull();
  });
});

describe("timeWindow", () => {
  it("opens on a working morning", () => {
    const window = prague("2026-10-20", "09:30");
    expect(window).toMatchObject({
      date: "2026-10-20",
      time: "09:30",
      weekday: 2,
      workingDay: true,
      workingHours: true,
      open: true,
      preferred: true,
      reason: null,
      nextOpenAt: null,
      source: "default",
      prepare: [],
    });
    expect(window.preferredToday).toEqual([
      ["08:00", "12:00"],
      ["13:00", "17:30"],
    ]);
  });

  it("stays open over lunch but prefers the afternoon", () => {
    const window = prague("2026-10-20", "12:20");
    expect(window.open).toBe(true);
    expect(window.preferred).toBe(false);
    expect(window.reason).toBe("lunch");
    expect(window.nextPreferredAt).toEqual(at("2026-10-20", "13:00"));
  });

  it("closes at 17:30 and suggests preparation until the next morning", () => {
    expect(prague("2026-10-20", "17:29").open).toBe(true);
    const window = prague("2026-10-20", "17:30");
    expect(window.open).toBe(false);
    expect(window.workingHours).toBe(false);
    expect(window.reason).toBe("afterHours");
    expect(window.nextOpenAt).toEqual(at("2026-10-21", "08:00"));
    expect(window.prepare).toEqual(PREP_ACTIVITIES);
  });

  it("is closed in the evening and early in the morning", () => {
    expect(prague("2026-10-20", "21:00")).toMatchObject({ open: false, reason: "afterHours" });
    const early = prague("2026-10-20", "07:10");
    expect(early).toMatchObject({ open: false, reason: "beforeHours" });
    expect(early.nextOpenAt).toEqual(at("2026-10-20", "08:00"));
  });

  it("skips the weekend", () => {
    const friday = prague("2026-10-16", "19:00");
    expect(friday.nextOpenAt).toEqual(at("2026-10-19", "08:00"));
    const saturday = prague("2026-10-17", "10:00");
    expect(saturday).toMatchObject({ workingDay: false, open: false, reason: "weekend" });
    expect(saturday.preferredToday).toEqual([]);
    expect(saturday.nextOpenAt).toEqual(at("2026-10-19", "08:00"));
  });

  it("skips Czech public holidays, Easter included", () => {
    const independence = prague("2026-10-28", "10:00");
    expect(independence).toMatchObject({
      holiday: "independence",
      workingDay: false,
      open: false,
      reason: "holiday",
    });
    expect(independence.nextOpenAt).toEqual(at("2026-10-29", "08:00"));
    // Thursday before Easter: Good Friday and Easter Monday are both off.
    expect(prague("2026-04-02", "18:00").nextOpenAt).toEqual(at("2026-04-07", "08:00"));
    // Christmas: 24, 25, 26 December 2026 (Thu–Sat), then the weekend.
    expect(prague("2026-12-23", "18:00").nextOpenAt).toEqual(at("2026-12-28", "08:00"));
  });

  it("follows the daylight saving change", () => {
    // 17:45 local, 15:45 UTC in summer time: closed.
    const summer = timeWindow({
      now: new Date("2026-10-23T15:45:00Z"),
      timeZone: PRAGUE,
      country: "CZ",
    });
    expect(summer).toMatchObject({ time: "17:45", open: false });
    // Clocks went back on Sunday 25 October: Monday 8:00 is 07:00 UTC, not 06:00.
    expect(summer.nextOpenAt?.toISOString()).toBe("2026-10-26T07:00:00.000Z");
    // The same UTC time in winter is 16:45 local: open.
    const winter = timeWindow({
      now: new Date("2026-10-26T15:45:00Z"),
      timeZone: PRAGUE,
      country: "CZ",
    });
    expect(winter).toMatchObject({ time: "16:45", open: true });
    // Spring forward on Sunday 29 March: Monday 8:00 is 06:00 UTC.
    expect(prague("2026-03-29", "20:00").nextOpenAt?.toISOString()).toBe(
      "2026-03-30T06:00:00.000Z",
    );
  });

  it("works in another zone and country", () => {
    const zone = "America/New_York";
    // 28 October is a Czech holiday, but an ordinary Wednesday in New York.
    const newYork = timeWindow({
      now: at("2026-10-28", "10:00", zone),
      timeZone: zone,
      country: "US",
    });
    expect(newYork).toMatchObject({ time: "10:00", open: true, holiday: null });
    // 10:00 in New York is 15:00 in Prague, yet the Czech user has a holiday.
    expect(
      timeWindow({ now: at("2026-10-28", "10:00", zone), timeZone: PRAGUE, country: "CZ" }),
    ).toMatchObject({ time: "15:00", open: false, reason: "holiday" });
    // 18:00 in New York is after hours there, whatever the time in Prague.
    const evening = timeWindow({
      now: at("2026-10-20", "18:00", zone),
      timeZone: zone,
      country: "US",
    });
    expect(evening.open).toBe(false);
    expect(evening.nextOpenAt).toEqual(at("2026-10-21", "08:00", zone));
  });

  it("counts an account without a country in the Czech zone as Czech", () => {
    expect(
      timeWindow({ now: at("2026-10-28", "10:00"), timeZone: PRAGUE, country: null }).holiday,
    ).toBe("independence");
  });
});

describe("the country's call statistics", () => {
  /** Mon–Fri 9–16 with 30 attempts each; 14:00 and 15:00 bring the meetings. */
  function stats(extra: StatRow[] = []): StatRow[] {
    const rows: StatRow[] = [];
    for (let day = 1; day <= 5; day++) {
      for (let hour = 9; hour <= 16; hour++) {
        rows.push({
          day_of_week: day,
          hour,
          attempts: 30,
          meetings: hour === 14 || hour === 15 ? 6 : 1,
        });
      }
    }
    return [...rows, ...extra];
  }

  it("ignores a country with too little data", () => {
    expect(
      bestHoursFromStats([{ day_of_week: 1, hour: 10, attempts: 150, meetings: 20 }]),
    ).toBeNull();
    expect(prague("2026-10-20", "10:00", []).source).toBe("default");
  });

  it("takes the best hours when there is enough data", () => {
    const best = bestHoursFromStats(stats());
    expect(best?.get(2)).toEqual([14, 15]);
    const morning = prague("2026-10-20", "10:00", stats());
    expect(morning).toMatchObject({
      source: "stats",
      open: true,
      preferred: false,
      reason: "offPeak",
    });
    expect(morning.nextPreferredAt).toEqual(at("2026-10-20", "14:00"));
    expect(morning.preferredToday).toEqual([["14:00", "16:00"]]);
  });

  it("lets a strong evening hour widen the window on working days only", () => {
    const evening = stats([{ day_of_week: 2, hour: 18, attempts: 40, meetings: 10 }]);
    expect(prague("2026-10-20", "18:30", evening)).toMatchObject({ open: true, preferred: true });
    // Still nothing on a holiday.
    expect(prague("2026-10-28", "14:30", evening).open).toBe(false);
  });
});

describe("describing the window for Jarvis", () => {
  const settings = { ...DEFAULT_FORMAT_SETTINGS, timeZone: PRAGUE };

  it("offers preparation and the next time outside the window", () => {
    const now = at("2026-10-16", "19:05");
    const text = describeTimeWindow(prague("2026-10-16", "19:05"), now, settings);
    expect(text).toContain("Local time now: 19:05, Friday. Working hours now: no.");
    expect(text).toContain("Next time to reach people: Monday 2026-10-19 at 08:00.");
    expect(text).toContain("e-mails to send in the morning");
  });

  it("says when it is a good time", () => {
    const now = at("2026-10-20", "10:00");
    expect(describeTimeWindow(prague("2026-10-20", "10:00"), now, settings)).toContain(
      "Calls and meetings: a good time now.",
    );
  });

  it("plans the day for the morning brief", () => {
    expect(describeDayPlan(prague("2026-10-20", "06:30"), settings)).toContain(
      "Best times for calls and meetings: 08:00–12:00, 13:00–17:30.",
    );
    const holiday = describeDayPlan(prague("2026-10-28", "06:30"), settings);
    expect(holiday).toContain("public holiday: no calls or meetings");
    expect(holiday).toContain("Thursday 2026-10-29 at 08:00");
  });
});
