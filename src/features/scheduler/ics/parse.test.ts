import { describe, expect, it } from "vitest";
import { icsBusy, parseDuration, parseIcs, resolveTimeZone } from "./parse";

const cal = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", ...events, "END:VCALENDAR"].join("\r\n");

const ev = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

const at = (iso: string) => Date.parse(iso);

/** A window over 2026 so most events fall into it. */
const YEAR = { from: at("2026-01-01T00:00:00Z"), to: at("2027-01-01T00:00:00Z") };
const PRAGUE = "Europe/Prague";

function busy(text: string, window = YEAR, zone = PRAGUE) {
  return icsBusy(text, { ...window, defaultTimeZone: zone });
}

describe("parseIcs", () => {
  it("reads events inside a calendar and skips alarms and broken ones", () => {
    const text = cal(
      ev(
        "UID:a",
        "DTSTART:20260310T090000Z",
        "DTEND:20260310T100000Z",
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "DTSTART:20200101T000000Z",
        "END:VALARM",
      ),
      ev("UID:broken", "DTSTART:notadate"),
      ev("UID:nostart", "DTEND:20260310T100000Z"),
    );
    const events = parseIcs(text);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: "a",
      start: { kind: "utc", ms: at("2026-03-10T09:00:00Z") },
    });
  });

  it("returns nothing for garbage and never throws", () => {
    expect(parseIcs("")).toEqual([]);
    expect(parseIcs("hello\nworld")).toEqual([]);
    expect(parseIcs("BEGIN:VEVENT\nDTSTART:20260101T000000Z\nEND:VEVENT")).toEqual([]);
    expect(busy("\u0000\u0001 nonsense ::: ;;;")).toEqual([]);
    expect(busy(cal(ev('DTSTART;TZID="Broken:20260101T090000', "RRULE:FREQ=SOMETIMES")))).toEqual(
      [],
    );
  });

  it("unfolds continuation lines", () => {
    const text = cal(
      [
        "BEGIN:VEVENT",
        "UID:fold",
        "DTSTART;TZID=Europe/Pra",
        " gue:20260310T090000",
        "DTEND;TZID=Europe/Prague:2026031",
        "\t0T100000",
        "END:VEVENT",
      ].join("\n"),
    );
    expect(busy(text)).toEqual([
      { start: "2026-03-10T08:00:00.000Z", end: "2026-03-10T09:00:00.000Z" },
    ]);
  });

  it("parses durations", () => {
    expect(parseDuration("PT1H30M")).toEqual({ days: 0, ms: 5_400_000 });
    expect(parseDuration("P1D")).toEqual({ days: 1, ms: 0 });
    expect(parseDuration("P2W")).toEqual({ days: 14, ms: 0 });
    expect(parseDuration("P")).toBeNull();
    expect(parseDuration("-PT5M")).toBeNull();
  });

  it("maps zone names", () => {
    expect(resolveTimeZone("Europe/Prague")).toBe("Europe/Prague");
    expect(resolveTimeZone('"Europe/Prague"')).toBe("Europe/Prague");
    expect(resolveTimeZone("/mozilla.org/20050126_1/Europe/Prague")).toBe("Europe/Prague");
    expect(resolveTimeZone("Central Europe Standard Time")).toBe("Europe/Prague");
    expect(resolveTimeZone("Pacific Standard Time")).toBe("America/Los_Angeles");
    expect(resolveTimeZone("Nowhere/Never")).toBeNull();
    expect(resolveTimeZone(undefined)).toBeNull();
  });
});

describe("icsBusy: single events", () => {
  it("a timed event in UTC", () => {
    expect(busy(cal(ev("UID:1", "DTSTART:20260310T090000Z", "DTEND:20260310T100000Z")))).toEqual([
      { start: "2026-03-10T09:00:00.000Z", end: "2026-03-10T10:00:00.000Z" },
    ]);
  });

  it("a timed event with TZID, summer and winter", () => {
    const text = cal(
      ev(
        "UID:w",
        "DTSTART;TZID=Europe/Prague:20260310T090000",
        "DTEND;TZID=Europe/Prague:20260310T100000",
      ),
      ev("UID:s", "DTSTART;TZID=Europe/Prague:20260710T090000", "DURATION:PT30M"),
    );
    expect(busy(text)).toEqual([
      { start: "2026-03-10T08:00:00.000Z", end: "2026-03-10T09:00:00.000Z" },
      { start: "2026-07-10T07:00:00.000Z", end: "2026-07-10T07:30:00.000Z" },
    ]);
  });

  it("a floating time and an unknown zone take the default zone", () => {
    const text = cal(
      ev("UID:f", "DTSTART:20260310T090000", "DTEND:20260310T100000"),
      ev(
        "UID:u",
        "DTSTART;TZID=Mars/Olympus:20260311T090000",
        "DTEND;TZID=Mars/Olympus:20260311T100000",
      ),
    );
    expect(busy(text, YEAR, "America/New_York")).toEqual([
      { start: "2026-03-10T13:00:00.000Z", end: "2026-03-10T14:00:00.000Z" },
      { start: "2026-03-11T13:00:00.000Z", end: "2026-03-11T14:00:00.000Z" },
    ]);
  });

  it("an Outlook Windows zone", () => {
    const text = cal(
      ev(
        "UID:o",
        'DTSTART;TZID="Central Europe Standard Time":20260410T140000',
        'DTEND;TZID="Central Europe Standard Time":20260410T150000',
      ),
    );
    expect(busy(text)).toEqual([
      { start: "2026-04-10T12:00:00.000Z", end: "2026-04-10T13:00:00.000Z" },
    ]);
  });

  it("all-day events from midnight to midnight in the default zone, end exclusive", () => {
    const text = cal(
      ev("UID:d1", "DTSTART;VALUE=DATE:20260501", "DTEND;VALUE=DATE:20260503"),
      ev("UID:d2", "DTSTART;VALUE=DATE:20260601"),
    );
    expect(busy(text)).toEqual([
      { start: "2026-04-30T22:00:00.000Z", end: "2026-05-02T22:00:00.000Z", allDay: true },
      { start: "2026-05-31T22:00:00.000Z", end: "2026-06-01T22:00:00.000Z", allDay: true },
    ]);
  });

  it("free (transparent) and cancelled events are not busy; zero length is skipped", () => {
    const text = cal(
      ev("UID:t", "DTSTART:20260310T090000Z", "DTEND:20260310T100000Z", "TRANSP:TRANSPARENT"),
      ev("UID:c", "DTSTART:20260311T090000Z", "DTEND:20260311T100000Z", "STATUS:CANCELLED"),
      ev("UID:z", "DTSTART:20260312T090000Z"),
      ev("UID:b", "DTSTART:20260313T090000Z", "DTEND:20260313T100000Z", "TRANSP:OPAQUE"),
    );
    expect(busy(text)).toEqual([
      { start: "2026-03-13T09:00:00.000Z", end: "2026-03-13T10:00:00.000Z" },
    ]);
  });

  it("clips to the window and merges overlapping and touching intervals", () => {
    const text = cal(
      ev("UID:1", "DTSTART:20260310T080000Z", "DTEND:20260310T100000Z"),
      ev("UID:2", "DTSTART:20260310T093000Z", "DTEND:20260310T110000Z"),
      ev("UID:3", "DTSTART:20260310T110000Z", "DTEND:20260310T120000Z"),
      ev("UID:4", "DTSTART:20260310T130000Z", "DTEND:20260310T140000Z"),
      ev("UID:5", "DTSTART:20260309T000000Z", "DTEND:20260309T010000Z"),
    );
    const window = { from: at("2026-03-10T09:00:00Z"), to: at("2026-03-10T13:30:00Z") };
    expect(busy(text, window)).toEqual([
      { start: "2026-03-10T09:00:00.000Z", end: "2026-03-10T12:00:00.000Z" },
      { start: "2026-03-10T13:00:00.000Z", end: "2026-03-10T13:30:00.000Z" },
    ]);
  });

  it("caps the number of intervals", () => {
    const text = cal(
      ev("UID:r", "DTSTART:20260101T090000Z", "DTEND:20260101T100000Z", "RRULE:FREQ=DAILY"),
    );
    expect(icsBusy(text, { ...YEAR, defaultTimeZone: PRAGUE, maxIntervals: 5 })).toHaveLength(5);
    expect(icsBusy(text, { ...YEAR, defaultTimeZone: PRAGUE, maxOccurrences: 7 })).toHaveLength(7);
  });
});

describe("icsBusy: recurrence", () => {
  it("weekly on Monday and Wednesday stays at 09:00 Prague across the DST change", () => {
    const text = cal(
      ev(
        "UID:w",
        "DTSTART;TZID=Europe/Prague:20260323T090000",
        "DTEND;TZID=Europe/Prague:20260323T100000",
        "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
      ),
    );
    const window = { from: at("2026-03-22T00:00:00Z"), to: at("2026-04-02T00:00:00Z") };
    expect(busy(text, window)).toEqual([
      { start: "2026-03-23T08:00:00.000Z", end: "2026-03-23T09:00:00.000Z" },
      { start: "2026-03-25T08:00:00.000Z", end: "2026-03-25T09:00:00.000Z" },
      // After 29 March Prague is UTC+2.
      { start: "2026-03-30T07:00:00.000Z", end: "2026-03-30T08:00:00.000Z" },
      { start: "2026-04-01T07:00:00.000Z", end: "2026-04-01T08:00:00.000Z" },
    ]);
  });

  it("daily with COUNT, counted from the first occurrence", () => {
    const text = cal(
      ev("UID:d", "DTSTART:20260301T120000Z", "DTEND:20260301T130000Z", "RRULE:FREQ=DAILY;COUNT=3"),
    );
    const window = { from: at("2026-03-02T00:00:00Z"), to: at("2026-03-10T00:00:00Z") };
    expect(busy(text, window).map((b) => b.start)).toEqual([
      "2026-03-02T12:00:00.000Z",
      "2026-03-03T12:00:00.000Z",
    ]);
  });

  it("daily with INTERVAL from years back reaches the window", () => {
    const text = cal(
      ev(
        "UID:i",
        "DTSTART:20150101T120000Z",
        "DTEND:20150101T130000Z",
        "RRULE:FREQ=DAILY;INTERVAL=2",
      ),
    );
    const window = { from: at("2026-03-01T00:00:00Z"), to: at("2026-03-07T00:00:00Z") };
    const starts = busy(text, window).map((b) => b.start);
    expect(starts).toHaveLength(3);
    // Every other day from 2015-01-01.
    const day = (iso: string) =>
      Math.round((Date.parse(iso) - at("2015-01-01T12:00:00Z")) / 86_400_000);
    for (const start of starts) expect(day(start) % 2).toBe(0);
  });

  it("monthly on the last Friday", () => {
    const text = cal(
      ev(
        "UID:m",
        "DTSTART;TZID=Europe/Prague:20260130T150000",
        "DTEND;TZID=Europe/Prague:20260130T160000",
        "RRULE:FREQ=MONTHLY;BYDAY=-1FR",
      ),
    );
    const window = { from: at("2026-01-01T00:00:00Z"), to: at("2026-05-01T00:00:00Z") };
    expect(busy(text, window).map((b) => b.start)).toEqual([
      "2026-01-30T14:00:00.000Z",
      "2026-02-27T14:00:00.000Z",
      "2026-03-27T14:00:00.000Z",
      "2026-04-24T13:00:00.000Z",
    ]);
  });

  it("monthly on the 31st skips short months; yearly on a date", () => {
    const text = cal(
      ev(
        "UID:31",
        "DTSTART:20260131T100000Z",
        "DTEND:20260131T110000Z",
        "RRULE:FREQ=MONTHLY;COUNT=4",
      ),
      ev("UID:y", "DTSTART;VALUE=DATE:20200615", "RRULE:FREQ=YEARLY"),
    );
    expect(busy(text).map((b) => b.start)).toEqual([
      "2026-01-31T10:00:00.000Z",
      "2026-03-31T10:00:00.000Z",
      "2026-05-31T10:00:00.000Z",
      "2026-06-14T22:00:00.000Z",
      "2026-07-31T10:00:00.000Z",
    ]);
  });

  it("monthly by negative month day and yearly by month and weekday", () => {
    const text = cal(
      ev(
        "UID:last",
        "DTSTART:20260131T100000Z",
        "DTEND:20260131T110000Z",
        "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3",
      ),
      ev(
        "UID:thx",
        "DTSTART;TZID=America/New_York:20261126T120000",
        "DTEND;TZID=America/New_York:20261126T130000",
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
      ),
    );
    expect(busy(text).map((b) => b.start)).toEqual([
      "2026-01-31T10:00:00.000Z",
      "2026-02-28T10:00:00.000Z",
      "2026-03-31T10:00:00.000Z",
      "2026-11-26T17:00:00.000Z",
    ]);
  });

  it("stops at UNTIL (date-time and date)", () => {
    const text = cal(
      ev(
        "UID:u1",
        "DTSTART:20260301T090000Z",
        "DTEND:20260301T093000Z",
        "RRULE:FREQ=DAILY;UNTIL=20260303T090000Z",
      ),
      ev("UID:u2", "DTSTART;VALUE=DATE:20260401", "RRULE:FREQ=WEEKLY;UNTIL=20260415"),
    );
    expect(busy(text).map((b) => b.start)).toEqual([
      "2026-03-01T09:00:00.000Z",
      "2026-03-02T09:00:00.000Z",
      "2026-03-03T09:00:00.000Z",
      "2026-03-31T22:00:00.000Z",
      "2026-04-07T22:00:00.000Z",
      "2026-04-14T22:00:00.000Z",
    ]);
  });

  it("EXDATE removes occurrences in TZID and UTC forms", () => {
    const text = cal(
      ev(
        "UID:x",
        "DTSTART;TZID=Europe/Prague:20260302T090000",
        "DTEND;TZID=Europe/Prague:20260302T100000",
        "RRULE:FREQ=DAILY;COUNT=5",
        "EXDATE;TZID=Europe/Prague:20260303T090000,20260304T090000",
        "EXDATE:20260305T080000Z",
      ),
    );
    expect(busy(text).map((b) => b.start)).toEqual([
      "2026-03-02T08:00:00.000Z",
      "2026-03-06T08:00:00.000Z",
    ]);
  });

  it("a moved occurrence replaces the original, a cancelled one removes it", () => {
    const text = cal(
      ev(
        "UID:s",
        "DTSTART;TZID=Europe/Prague:20260302T090000",
        "DTEND;TZID=Europe/Prague:20260302T100000",
        "RRULE:FREQ=DAILY;COUNT=4",
      ),
      ev(
        "UID:s",
        "RECURRENCE-ID;TZID=Europe/Prague:20260303T090000",
        "DTSTART;TZID=Europe/Prague:20260303T150000",
        "DTEND;TZID=Europe/Prague:20260303T160000",
      ),
      ev(
        "UID:s",
        "RECURRENCE-ID:20260304T080000Z",
        "DTSTART;TZID=Europe/Prague:20260304T090000",
        "DTEND;TZID=Europe/Prague:20260304T100000",
        "STATUS:CANCELLED",
      ),
    );
    expect(busy(text).map((b) => b.start)).toEqual([
      "2026-03-02T08:00:00.000Z",
      "2026-03-03T14:00:00.000Z",
      "2026-03-05T08:00:00.000Z",
    ]);
  });

  it("RDATE adds occurrences", () => {
    const text = cal(
      ev(
        "UID:r",
        "DTSTART:20260302T090000Z",
        "DTEND:20260302T100000Z",
        "RDATE:20260310T090000Z,20260312T090000Z",
      ),
    );
    expect(busy(text).map((b) => b.start)).toEqual([
      "2026-03-02T09:00:00.000Z",
      "2026-03-10T09:00:00.000Z",
      "2026-03-12T09:00:00.000Z",
    ]);
  });

  it("an all-day recurring event keeps the flag and merges only with all-day ones", () => {
    const text = cal(
      ev(
        "UID:a",
        "DTSTART;VALUE=DATE:20260302",
        "DTEND;VALUE=DATE:20260303",
        "RRULE:FREQ=DAILY;COUNT=2",
      ),
      ev("UID:t", "DTSTART:20260302T090000Z", "DTEND:20260302T100000Z"),
    );
    expect(busy(text)).toEqual([
      { start: "2026-03-01T23:00:00.000Z", end: "2026-03-03T23:00:00.000Z", allDay: true },
      { start: "2026-03-02T09:00:00.000Z", end: "2026-03-02T10:00:00.000Z" },
    ]);
  });
});
