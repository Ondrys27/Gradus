import { describe, expect, it } from "vitest";
import { buildIcsFeed, escapeText, foldLine } from "./export";
import { icsBusy, parseIcs } from "./parse";

const NOW = new Date("2026-11-09T10:00:00Z");

describe("buildIcsFeed", () => {
  const feed = buildIcsFeed({
    name: "Ondřej, práce",
    now: NOW,
    timeZone: "Europe/Prague",
    events: [
      {
        uid: "e1@gradus",
        title: "Schůzka; Novák, s.r.o.",
        start: "2026-11-10T09:00:00.000Z",
        end: "2026-11-10T10:00:00.000Z",
        allDay: false,
        description: "Řádek 1\nŘádek 2 \\ konec",
        location: "Praha",
        updatedAt: "2026-11-01T08:00:00.000Z",
      },
      {
        uid: "e2@gradus",
        title: "Bez konce",
        start: "2026-11-11T13:00:00.000Z",
        end: null,
        allDay: false,
      },
      {
        uid: "e3@gradus",
        title: "Celý den",
        // Midnight in Prague of the 12th and of the 13th (the last day).
        start: "2026-11-11T23:00:00.000Z",
        end: "2026-11-12T23:00:00.000Z",
        allDay: true,
      },
      { uid: "bad", title: "x", start: "nonsense", end: null, allDay: false },
    ],
  });

  it("is a publishable calendar with CRLF lines", () => {
    expect(
      feed.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Gradus//Calendar//EN\r\n"),
    ).toBe(true);
    expect(feed).toContain("METHOD:PUBLISH\r\n");
    expect(feed).toContain("X-WR-CALNAME:Ondřej\\, práce\r\n");
    expect(feed).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n");
    expect(feed).toContain("X-PUBLISHED-TTL:PT1H\r\n");
    expect(feed.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(feed.replace(/\r\n/g, "")).not.toMatch(/\n|\r/);
  });

  it("writes times in UTC, all-day days in the zone with an exclusive end", () => {
    expect(feed).toContain("DTSTAMP:20261109T100000Z");
    expect(feed).toContain("DTSTART:20261110T090000Z\r\nDTEND:20261110T100000Z");
    expect(feed).toContain("LAST-MODIFIED:20261101T080000Z");
    expect(feed).toContain("DTSTART:20261111T130000Z\r\nDTEND:20261111T140000Z");
    expect(feed).toContain("DTSTART;VALUE=DATE:20261112\r\nDTEND;VALUE=DATE:20261114");
    expect(feed).not.toContain("UID:bad");
  });

  it("escapes text", () => {
    expect(feed).toContain("SUMMARY:Schůzka\\; Novák\\, s.r.o.");
    expect(escapeText("a\\b;c,d\r\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });

  it("round trips through the parser", () => {
    const events = parseIcs(feed);
    expect(events.map((event) => event.uid)).toEqual(["e1@gradus", "e2@gradus", "e3@gradus"]);
    const busy = icsBusy(feed, {
      from: Date.parse("2026-11-01T00:00:00Z"),
      to: Date.parse("2026-12-01T00:00:00Z"),
      defaultTimeZone: "Europe/Prague",
    });
    // The all-day event is published as free time, like all-day events in Gradus.
    expect(busy).toEqual([
      { start: "2026-11-10T09:00:00.000Z", end: "2026-11-10T10:00:00.000Z" },
      { start: "2026-11-11T13:00:00.000Z", end: "2026-11-11T14:00:00.000Z" },
    ]);
    expect(events[2]).toMatchObject({ allDay: true, transparent: true });
  });
});

describe("foldLine", () => {
  it("leaves short lines alone", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds at 75 octets without splitting a multi-byte character", () => {
    const line = `DESCRIPTION:${"ř".repeat(100)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    const encoder = new TextEncoder();
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    for (const part of parts.slice(1)) expect(part.startsWith(" ")).toBe(true);
    expect(parts.map((part, i) => (i ? part.slice(1) : part)).join("")).toBe(line);
    expect(folded).not.toContain("�");
  });
});
