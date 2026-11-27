import { describe, expect, it } from "vitest";
import {
  bookingWriteTarget,
  parseCalendarSources,
  resolveSources,
  sourceCount,
  toStored,
  validCalendarSources,
  type AvailableSources,
} from "./calendar-sources";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const S = "00000000-0000-4000-8000-00000000000c";
const GONE = "00000000-0000-4000-8000-00000000000d";

const available: AvailableSources = {
  // A is shown in the Calendar and the general calendar to write to; B is neither.
  calendars: [
    { id: A, canWrite: true, read: true, write: true },
    { id: B, canWrite: true, read: false, write: false },
  ],
  subscriptions: [{ id: S }],
};

describe("calendar sources of the scheduler", () => {
  it("validates as the database does", () => {
    expect(validCalendarSources(null)).toBe(true);
    expect(validCalendarSources({ gradus: true, calendars: [], subscriptions: [] })).toBe(true);
    expect(
      validCalendarSources({ gradus: true, calendars: [A], subscriptions: [S], write: null }),
    ).toBe(true);
    expect(validCalendarSources({ gradus: true, calendars: [] })).toBe(false);
    expect(validCalendarSources({ gradus: true, calendars: ["x"], subscriptions: [] })).toBe(false);
    expect(validCalendarSources({ gradus: true, calendars: [], subscriptions: [], extra: 1 })).toBe(
      false,
    );
    expect(parseCalendarSources({ gradus: 1 })).toBeNull();
  });

  it("a profile from before 30.4 counts everything it did: Gradus, the calendars it shows, every subscription", () => {
    expect(resolveSources(null, null, available)).toEqual({
      gradus: true,
      calendars: [A],
      subscriptions: [S],
      write: A,
    });
  });

  it("a new profile counts only Gradus and writes where Settings → Calendar writes", () => {
    expect(
      resolveSources({ gradus: true, calendars: [], subscriptions: [] }, null, available),
    ).toEqual({
      gradus: true,
      calendars: [],
      subscriptions: [],
      write: A,
    });
  });

  it("chosen calendars count whether the Calendar shows them or not; gone ones drop out", () => {
    const resolved = resolveSources(
      { gradus: false, calendars: [B, GONE], subscriptions: [GONE], write: B },
      null,
      available,
    );
    expect(resolved).toEqual({ gradus: false, calendars: [B], subscriptions: [], write: B });
    expect(sourceCount(resolved)).toBe(1);
  });

  it("a type's own sources win over the profile's; null falls back", () => {
    const profile = { gradus: true, calendars: [A], subscriptions: [], write: null };
    const type = { gradus: false, calendars: [], subscriptions: [S] };
    expect(resolveSources(profile, type, available)).toMatchObject({
      gradus: false,
      subscriptions: [S],
    });
    expect(resolveSources(profile, null, available)).toMatchObject({
      gradus: true,
      calendars: [A],
      write: null,
    });
  });

  it("a write calendar that cannot be written is Gradus only", () => {
    expect(
      resolveSources(
        { gradus: true, calendars: [], subscriptions: [], write: GONE },
        null,
        available,
      ).write,
    ).toBeNull();
  });

  it("is stored explicitly, and tells the sync engine where a booking goes", () => {
    const stored = toStored({ gradus: true, calendars: [A, A], subscriptions: [], write: null });
    expect(stored).toEqual({ gradus: true, calendars: [A], subscriptions: [], write: null });
    expect(bookingWriteTarget(null, null)).toEqual({ kind: "default" });
    expect(bookingWriteTarget({ gradus: true, calendars: [], subscriptions: [] }, null)).toEqual({
      kind: "default",
    });
    expect(bookingWriteTarget(stored, null)).toEqual({ kind: "none" });
    expect(
      bookingWriteTarget(stored, { gradus: true, calendars: [], subscriptions: [], write: B }),
    ).toEqual({
      kind: "calendar",
      id: B,
    });
  });
});
