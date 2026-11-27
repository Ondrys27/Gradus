import { describe, expect, it } from "vitest";
import {
  activeBlockAt,
  blockStartAt,
  copyDay,
  dayKeyFor,
  insertionStart,
  manualPickPatch,
  moveStart,
  parseThemeSchedule,
  periodOf,
  resolveRef,
  suggestedBlocks,
  switchMode,
  withoutMissingThemes,
  type ScheduleBlock,
  type ThemeSchedule,
} from "./schedule";

const PRAGUE = "Europe/Prague";
const block = (id: string, start: number, theme: string, name = id): ScheduleBlock => ({
  id,
  name,
  start,
  theme: theme as ScheduleBlock["theme"],
  caption: null,
});
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

const threeBlocks = [block("m", h(6), "light"), block("a", h(12), "gradus"), block("e", h(18), "midnight")];
const same: ThemeSchedule = { v: 1, enabled: true, mode: "same", days: { all: threeBlocks } };

const at = (iso: string) => Date.parse(iso);

describe("parseThemeSchedule", () => {
  it("takes a valid schedule as it is", () => {
    expect(parseThemeSchedule(same)).toEqual(same);
  });

  it("refuses the wrong shape", () => {
    expect(parseThemeSchedule(null)).toBeNull();
    expect(parseThemeSchedule({ ...same, v: 2 })).toBeNull();
    expect(parseThemeSchedule({ ...same, extra: 1 })).toBeNull();
    // one block only, nine blocks
    expect(parseThemeSchedule({ ...same, days: { all: [threeBlocks[0]] } })).toBeNull();
    const nine = Array.from({ length: 9 }, (_, i) => block(`x${i}`, i * 60, "gradus"));
    expect(parseThemeSchedule({ ...same, days: { all: nine } })).toBeNull();
    // starts not rising, duplicate id, a locked-looking but unknown theme, a bad custom ref
    expect(parseThemeSchedule({ ...same, days: { all: [threeBlocks[1], threeBlocks[0]] } })).toBeNull();
    expect(
      parseThemeSchedule({ ...same, days: { all: [block("m", 60, "gradus"), block("m", 120, "gradus")] } }),
    ).toBeNull();
    expect(parseThemeSchedule({ ...same, days: { all: [block("m", 60, "nope"), threeBlocks[1]] } })).toBeNull();
    expect(
      parseThemeSchedule({ ...same, days: { all: [block("m", 60, "custom:123"), threeBlocks[1]] } }),
    ).toBeNull();
    // a day list the mode does not have, and a missing one
    expect(parseThemeSchedule({ ...same, days: { all: threeBlocks, weekend: threeBlocks } })).toBeNull();
    expect(parseThemeSchedule({ ...same, mode: "weekdays" })).toBeNull();
    // name and caption: trimmed, within limits
    expect(parseThemeSchedule({ ...same, days: { all: [block("m", 0, "gradus", " x"), threeBlocks[1]] } })).toBeNull();
    expect(
      parseThemeSchedule({
        ...same,
        days: { all: [{ ...threeBlocks[0], caption: "x".repeat(121) }, threeBlocks[1]] },
      }),
    ).toBeNull();
    expect(parseThemeSchedule({ ...same, days: { all: [{ ...threeBlocks[0], start: 1440 }, threeBlocks[1]] } })).toBeNull();
  });

  it("accepts a custom theme ref", () => {
    const ref = "custom:0f8fad5b-d9cb-469f-a165-70867728950e";
    const schedule = { ...same, days: { all: [block("m", 60, ref), threeBlocks[1]] } };
    expect(parseThemeSchedule(schedule)?.days.all?.[0].theme).toBe(ref);
  });
});

describe("the block in charge", () => {
  it("follows the starts through the day in the user's zone", () => {
    // 2026-11-27 is a Friday; Prague is UTC+1 in November.
    expect(activeBlockAt(same, at("2026-11-27T05:00:00Z"), PRAGUE)?.block.id).toBe("m"); // 06:00
    expect(activeBlockAt(same, at("2026-11-27T10:59:00Z"), PRAGUE)?.block.id).toBe("m"); // 11:59
    expect(activeBlockAt(same, at("2026-11-27T11:00:00Z"), PRAGUE)?.block.id).toBe("a"); // 12:00
    expect(activeBlockAt(same, at("2026-11-27T17:00:00Z"), PRAGUE)?.block.id).toBe("e"); // 18:00
  });

  it("carries the evening past midnight until the morning block", () => {
    const night = activeBlockAt(same, at("2026-11-27T23:30:00Z"), PRAGUE); // 00:30 on Saturday
    expect(night?.block.id).toBe("e");
    expect(night?.startedAt).toBe(at("2026-11-27T17:00:00Z"));
    expect(night?.endsAt).toBe(at("2026-11-28T05:00:00Z"));
    expect(night?.next.id).toBe("m");
    expect(activeBlockAt(same, at("2026-11-28T04:59:00Z"), PRAGUE)?.block.id).toBe("e");
  });

  it("gives the start and the end of the block", () => {
    const active = activeBlockAt(same, at("2026-11-27T09:00:00Z"), PRAGUE);
    expect(active?.startedAt).toBe(at("2026-11-27T05:00:00Z"));
    expect(active?.endsAt).toBe(at("2026-11-27T11:00:00Z"));
    expect(active?.next.id).toBe("a");
  });

  it("uses the zone, not the machine: the same instant is a different block in Tokyo", () => {
    const now = at("2026-11-27T05:00:00Z"); // 06:00 Prague, 14:00 Tokyo, 00:00 New York
    expect(activeBlockAt(same, now, PRAGUE)?.block.id).toBe("m");
    expect(activeBlockAt(same, now, "Asia/Tokyo")?.block.id).toBe("a");
    expect(activeBlockAt(same, now, "America/New_York")?.block.id).toBe("e");
  });

  it("splits weekdays and the weekend", () => {
    const weekend = [block("w1", h(9), "forest"), block("w2", h(20), "midnight")];
    const schedule: ThemeSchedule = { v: 1, enabled: true, mode: "weekdays", days: { weekdays: threeBlocks, weekend } };
    expect(dayKeyFor("weekdays", 5)).toBe("weekdays");
    expect(dayKeyFor("weekdays", 6)).toBe("weekend");
    expect(dayKeyFor("weekdays", 0)).toBe("weekend");
    // Friday 19:00 → evening of the weekdays
    expect(activeBlockAt(schedule, at("2026-11-27T18:00:00Z"), PRAGUE)?.block.id).toBe("e");
    // Saturday 08:00 → still Friday's evening (before Saturday's first block at 9)
    const saturday = activeBlockAt(schedule, at("2026-11-28T07:00:00Z"), PRAGUE);
    expect(saturday?.block.id).toBe("e");
    expect(saturday?.endsAt).toBe(at("2026-11-28T08:00:00Z"));
    // Saturday 10:00 → weekend
    expect(activeBlockAt(schedule, at("2026-11-28T09:00:00Z"), PRAGUE)?.block.id).toBe("w1");
    // Monday 05:00 → Sunday's evening
    expect(activeBlockAt(schedule, at("2026-11-30T04:00:00Z"), PRAGUE)?.block.id).toBe("w2");
  });

  it("knows every day of the week on its own", () => {
    const days: ThemeSchedule["days"] = {};
    for (let d = 0; d < 7; d += 1) {
      days[String(d) as "0"] = [block(`d${d}a`, h(8), "gradus"), block(`d${d}b`, h(16), "forest")];
    }
    const schedule: ThemeSchedule = { v: 1, enabled: true, mode: "each", days };
    expect(activeBlockAt(schedule, at("2026-11-25T09:00:00Z"), PRAGUE)?.block.id).toBe("d3a"); // Wednesday 10:00
    expect(activeBlockAt(schedule, at("2026-11-29T20:00:00Z"), PRAGUE)?.block.id).toBe("d0b"); // Sunday 21:00
  });
});

describe("summer time", () => {
  it("a start skipped by the spring jump begins at the jump", () => {
    // 2027-03-28: Prague goes 02:00 → 03:00 (01:00Z).
    expect(blockStartAt("2027-03-28", h(2, 30), PRAGUE)).toBe(at("2027-03-28T01:00:00Z"));
    expect(blockStartAt("2027-03-28", h(3), PRAGUE)).toBe(at("2027-03-28T01:00:00Z"));
    expect(blockStartAt("2027-03-28", h(6), PRAGUE)).toBe(at("2027-03-28T04:00:00Z"));
    const schedule: ThemeSchedule = {
      v: 1,
      enabled: true,
      mode: "same",
      days: { all: [block("x", h(2, 30), "forest"), block("y", h(12), "gradus")] },
    };
    // 03:30 CEST on the jump day: the 02:30 block began at the jump.
    const active = activeBlockAt(schedule, at("2027-03-28T01:30:00Z"), PRAGUE);
    expect(active?.block.id).toBe("x");
    expect(active?.startedAt).toBe(at("2027-03-28T01:00:00Z"));
  });

  it("a block on the jump keeps the day the same length otherwise", () => {
    // 06:00 → 12:00 on the spring day is five hours of real time.
    const active = activeBlockAt(same, at("2027-03-28T05:00:00Z"), PRAGUE);
    expect(active?.block.id).toBe("m");
    expect((active!.endsAt - active!.startedAt) / 3_600_000).toBe(6);
    const night = activeBlockAt(same, at("2027-03-28T01:00:00Z"), PRAGUE);
    // 18:00 CET Saturday → 06:00 CEST Sunday: 11 hours.
    expect((night!.endsAt - night!.startedAt) / 3_600_000).toBe(11);
  });

  it("a start that happens twice in the autumn begins the first time", () => {
    // 2026-10-25: 03:00 CEST → 02:00 CET, 02:30 happens at 00:30Z and 01:30Z.
    expect(blockStartAt("2026-10-25", h(2, 30), PRAGUE)).toBe(at("2026-10-25T00:30:00Z"));
    expect(blockStartAt("2026-10-25", h(12), PRAGUE)).toBe(at("2026-10-25T11:00:00Z"));
  });
});

describe("resolveRef and the manual pick", () => {
  const settings = {
    theme: "steel",
    custom_theme_id: null,
    theme_schedule: same,
    theme_override_until: null,
    timezone: PRAGUE,
  };

  it("the block's theme while the schedule is on", () => {
    const resolved = resolveRef(settings, at("2026-11-27T09:00:00Z"));
    expect(resolved.ref).toBe("light");
    expect(resolved.source).toBe("schedule");
  });

  it("the manual pick when the schedule is off or missing", () => {
    expect(resolveRef({ ...settings, theme_schedule: { ...same, enabled: false } }, at("2026-11-27T09:00:00Z")).ref).toBe("steel");
    expect(resolveRef({ ...settings, theme_schedule: null }, 0).ref).toBe("steel");
    expect(resolveRef({ ...settings, theme_schedule: { broken: true } }, 0).ref).toBe("steel");
  });

  it("a manual change holds until the next block begins", () => {
    const now = at("2026-11-27T09:00:00Z");
    const patch = manualPickPatch("forest", settings, now);
    expect(patch).toEqual({ theme: "forest", custom_theme_id: null, theme_override_until: "2026-11-27T11:00:00.000Z" });
    const after = { ...settings, ...patch };
    expect(resolveRef(after, now).ref).toBe("forest");
    expect(resolveRef(after, at("2026-11-27T10:59:59Z")).ref).toBe("forest");
    expect(resolveRef(after, at("2026-11-27T11:00:00Z")).ref).toBe("gradus");
  });

  it("a manual pick without the schedule is for good", () => {
    const patch = manualPickPatch("forest", { ...settings, theme_schedule: null }, 0);
    expect(patch.theme_override_until).toBeNull();
  });

  it("a custom theme keeps the built-in pick underneath", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const patch = manualPickPatch(`custom:${id}`, { ...settings, theme_schedule: null }, 0);
    expect(patch).toEqual({ theme: "steel", custom_theme_id: id, theme_override_until: null });
    expect(resolveRef({ ...settings, ...patch, theme_schedule: null }, 0).ref).toBe(`custom:${id}`);
  });
});

describe("editing", () => {
  it("drags a start in quarter hours, never past a neighbour", () => {
    expect(moveStart(threeBlocks, 1, h(13, 7)).map((b) => b.start)).toEqual([h(6), h(13), h(18)]);
    expect(moveStart(threeBlocks, 1, h(5)).map((b) => b.start)).toEqual([h(6), h(6, 15), h(18)]);
    expect(moveStart(threeBlocks, 1, h(23)).map((b) => b.start)).toEqual([h(6), h(17, 45), h(18)]);
    expect(moveStart(threeBlocks, 0, -30)[0].start).toBe(0);
    expect(moveStart(threeBlocks, 2, h(23, 59))[2].start).toBe(h(23, 45));
  });

  it("puts a new block halfway to the next one", () => {
    expect(insertionStart(threeBlocks, 0)).toBe(h(9));
    expect(insertionStart(threeBlocks, 2)).toBe(h(21));
    expect(insertionStart([block("a", 0, "gradus"), block("b", 15, "gradus")], 0)).toBeNull();
  });

  it("switching modes copies what the days had", () => {
    const weekdays = switchMode(same, "weekdays");
    expect(Object.keys(weekdays.days).sort()).toEqual(["weekdays", "weekend"]);
    expect(weekdays.days.weekend?.map((b) => b.id)).toEqual(["m", "a", "e"]);
    const each = switchMode({ ...weekdays, days: { ...weekdays.days, weekend: [block("w", 60, "forest"), block("v", 120, "gradus")] } }, "each");
    expect(each.days["6"]?.[0].id).toBe("w");
    expect(each.days["0"]?.[0].id).toBe("w");
    expect(each.days["3"]?.[0].id).toBe("m");
    expect(parseThemeSchedule(each)).not.toBeNull();
  });

  it("copies one day over others", () => {
    const each = switchMode(same, "each");
    const monday = [block("x", 60, "forest"), block("y", 600, "gradus")];
    const copied = copyDay({ ...each, days: { ...each.days, "1": monday } }, "1", ["2", "3"]);
    expect(copied.days["2"]?.[0].id).toBe("x");
    expect(copied.days["3"]?.[0].id).toBe("x");
    expect(copied.days["4"]?.[0].id).toBe("m");
  });

  it("a deleted custom theme becomes the default", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const schedule = { ...same, days: { all: [block("m", 60, `custom:${id}`), threeBlocks[1]] } };
    expect(withoutMissingThemes(schedule, new Set([id]))).toBe(schedule);
    expect(withoutMissingThemes(schedule, new Set()).days.all?.[0].theme).toBe("gradus");
  });

  it("suggests morning, afternoon and evening with what is open", () => {
    const names = { morning: "Ráno", afternoon: "Odpoledne", evening: "Večer" };
    expect(suggestedBlocks(names, "gradus", () => true).map((s) => [s.start, s.theme])).toEqual([
      [360, "light"],
      [720, "gradus"],
      [1080, "midnight"],
    ]);
    expect(suggestedBlocks(names, "forest", () => false).map((s) => s.theme)).toEqual(["forest", "forest", "forest"]);
  });

  it("names the time of day", () => {
    expect(periodOf(h(6))).toBe("morning");
    expect(periodOf(h(12))).toBe("afternoon");
    expect(periodOf(h(18))).toBe("evening");
    expect(periodOf(h(23))).toBe("night");
    expect(periodOf(h(3, 59))).toBe("night");
  });
});
