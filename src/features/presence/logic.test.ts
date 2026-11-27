import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS, lastSeenWhen } from "@/lib/format";
import {
  bestStatus,
  channelSpaces,
  isIdle,
  PRESENCE_IDLE_MS,
  PRESENCE_MAX_CHANNELS,
  presenceIn,
  presenceTopic,
  statusesOf,
  type PresencePerson,
} from "./logic";

const settings = {
  ...DEFAULT_FORMAT_SETTINGS,
  timeZone: "Europe/Prague",
  dateFormat: "d. M. yyyy",
};

describe("bestStatus: several tabs and devices are one status", () => {
  it("is online when any tab is in use", () => {
    expect(bestStatus([{ idle: true }, { idle: false }])).toBe("online");
  });
  it("is away when every open tab is idle", () => {
    expect(bestStatus([{ idle: true }, { idle: true }])).toBe("away");
  });
  it("is offline with no tab, and a broken entry is never online", () => {
    expect(bestStatus([])).toBe("offline");
    expect(bestStatus(undefined)).toBe("offline");
    expect(bestStatus([null, "x", { idle: "no" }])).toBe("away");
  });
});

describe("statusesOf", () => {
  it("reads the presence state keyed by account", () => {
    const statuses = statusesOf({ a: [{ idle: false }], b: [{ idle: true }], c: [] });
    expect([...statuses]).toEqual([
      ["a", "online"],
      ["b", "away"],
    ]);
  });
});

describe("channelSpaces", () => {
  const people: PresencePerson[] = [
    { spaceId: "own", userId: "me", lastSeenAt: null },
    { spaceId: "firm-b", userId: "boss-b", lastSeenAt: null },
    { spaceId: "firm-b", userId: "me", lastSeenAt: null },
    { spaceId: "firm-a", userId: "boss-a", lastSeenAt: null },
    { spaceId: "firm-a", userId: "me", lastSeenAt: null },
  ];
  it("joins only companies where someone else shows their status, in a stable order", () => {
    expect(channelSpaces(people, "me")).toEqual(["firm-a", "firm-b"]);
    expect(channelSpaces([...people].reverse(), "me")).toEqual(["firm-a", "firm-b"]);
  });
  it("joins nothing alone", () => {
    expect(channelSpaces([{ spaceId: "own", userId: "me", lastSeenAt: null }], "me")).toEqual([]);
  });
  it("is bounded", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      spaceId: `s${String(i).padStart(2, "0")}`,
      userId: `u${i}`,
      lastSeenAt: null,
    }));
    expect(channelSpaces(many, "me")).toHaveLength(PRESENCE_MAX_CHANNELS);
  });
  it("names the private channel by the space", () => {
    expect(presenceTopic("abc")).toBe("presence:abc");
  });
});

describe("presenceIn: what the viewer sees in the active company", () => {
  const people: PresencePerson[] = [
    { spaceId: "firm", userId: "jana", lastSeenAt: "2026-11-27T08:00:00Z" },
    { spaceId: "firm", userId: "petr", lastSeenAt: null },
    { spaceId: "other", userId: "eva", lastSeenAt: "2026-11-27T08:00:00Z" },
  ];
  const statuses = new Map([
    ["jana", "online" as const],
    ["eva", "online" as const],
    ["intruder", "online" as const],
  ]);

  it("shows the status, and the last moment only while offline", () => {
    expect(presenceIn(people, statuses, "firm", "jana")).toEqual({
      status: "online",
      lastSeenAt: null,
    });
    expect(presenceIn(people, statuses, "firm", "petr")).toEqual({
      status: "offline",
      lastSeenAt: null,
    });
    expect(presenceIn(people, new Map(), "firm", "jana")).toEqual({
      status: "offline",
      lastSeenAt: "2026-11-27T08:00:00Z",
    });
  });

  it("never shows someone of another company or an unlisted channel entry", () => {
    expect(presenceIn(people, statuses, "firm", "eva")).toBeNull();
    expect(presenceIn(people, statuses, "firm", "intruder")).toBeNull();
  });

  it("shows nothing until the company's channel is joined", () => {
    expect(presenceIn(people, undefined, "firm", "jana")).toBeNull();
  });
});

describe("isIdle", () => {
  it("turns away after 10 minutes without a touch", () => {
    expect(isIdle(0, PRESENCE_IDLE_MS - 1)).toBe(false);
    expect(isIdle(0, PRESENCE_IDLE_MS)).toBe(true);
    expect(isIdle(0, 5_000, 5_000)).toBe(true);
  });
});

describe("lastSeenWhen: relative time the way people say it", () => {
  const now = new Date("2026-11-27T14:00:00Z"); // Friday 15:00 in Prague
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const minute = 60_000;
  const hour = 60 * minute;

  it("says a moment ago, then minutes", () => {
    expect(lastSeenWhen(ago(30_000), now, settings)).toEqual({ kind: "moment" });
    expect(lastSeenWhen(ago(4 * minute), now, settings)).toEqual({ kind: "moment" });
    expect(lastSeenWhen(ago(5 * minute), now, settings)).toEqual({ kind: "minutes", count: 5 });
    expect(lastSeenWhen(ago(59 * minute), now, settings)).toEqual({ kind: "minutes", count: 59 });
  });

  it("says hours the same day", () => {
    expect(lastSeenWhen(ago(5 * hour), now, settings)).toEqual({ kind: "hours", count: 5 });
    expect(lastSeenWhen(ago(14 * hour + 30 * minute), now, settings)).toEqual({
      kind: "hours",
      count: 14,
    });
  });

  it("says hours past midnight under 6 hours, then yesterday", () => {
    const early = new Date("2026-11-27T01:00:00Z"); // 2:00 in Prague
    expect(lastSeenWhen(new Date("2026-11-26T22:00:00Z"), early, settings)).toEqual({
      kind: "hours",
      count: 3,
    });
    expect(lastSeenWhen(new Date("2026-11-26T10:00:00Z"), now, settings)).toEqual({
      kind: "yesterday",
    });
  });

  it("names the weekday within a week, then only the date", () => {
    // Monday 23 November 2026.
    expect(lastSeenWhen(new Date("2026-11-23T09:00:00Z"), now, settings)).toEqual({
      kind: "weekday",
      day: 1,
    });
    expect(lastSeenWhen(new Date("2026-11-20T09:00:00Z"), now, settings)).toEqual({
      kind: "date",
      date: "20. 11. 2026",
    });
  });

  it("counts days in the viewer's zone, not UTC", () => {
    // 23:30 UTC on the 26th is already the 27th in Prague: today, 14 hours ago.
    expect(lastSeenWhen(new Date("2026-11-26T23:30:00Z"), now, settings)).toEqual({
      kind: "hours",
      count: 14,
    });
    // The same moment is 18:30 of the day before in New York: yesterday there.
    const newYork = { ...settings, timeZone: "America/New_York" };
    expect(lastSeenWhen(new Date("2026-11-26T23:30:00Z"), now, newYork)).toEqual({
      kind: "yesterday",
    });
    // 13:00 UTC on the 26th: yesterday in Prague, also yesterday in New York (8:00 vs 9:00).
    expect(lastSeenWhen(new Date("2026-11-26T13:00:00Z"), now, newYork)).toEqual({
      kind: "yesterday",
    });
  });

  it("never says a time in the future", () => {
    expect(lastSeenWhen(new Date(now.getTime() + hour), now, settings)).toEqual({ kind: "moment" });
  });
});
