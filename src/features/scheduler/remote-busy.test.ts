import { describe, expect, it } from "vitest";
import type { RemoteEvent } from "@/features/calendar/sync/types";
import { busyOfRemote, cacheUsable, intervalsFromJson, intervalsToJson } from "./remote-busy";

const event = (patch: Partial<RemoteEvent>): RemoteEvent => ({
  externalId: "e",
  recurringId: null,
  etag: null,
  updatedAt: null,
  cancelled: false,
  title: "X",
  description: null,
  location: null,
  startsAt: "2026-12-01T09:00:00.000Z",
  endsAt: "2026-12-01T10:00:00.000Z",
  allDay: false,
  transparent: false,
  ...patch,
});
const ms = (iso: string) => Date.parse(iso);

describe("busy times read live from a connected calendar", () => {
  it("counts busy events, not free or cancelled ones, nor those Gradus wrote there", () => {
    const busy = busyOfRemote(
      [
        event({ externalId: "a" }),
        event({
          externalId: "b",
          transparent: true,
          startsAt: "2026-12-01T11:00:00.000Z",
          endsAt: "2026-12-01T12:00:00.000Z",
        }),
        event({
          externalId: "c",
          cancelled: true,
          startsAt: "2026-12-01T13:00:00.000Z",
          endsAt: "2026-12-01T14:00:00.000Z",
        }),
        event({
          externalId: "mine",
          startsAt: "2026-12-01T15:00:00.000Z",
          endsAt: "2026-12-01T16:00:00.000Z",
        }),
        event({
          externalId: "d",
          startsAt: "2026-12-01T09:30:00.000Z",
          endsAt: "2026-12-01T10:30:00.000Z",
        }),
      ],
      new Set(["mine"]),
    );
    expect(busy).toEqual([
      { start: ms("2026-12-01T09:00:00.000Z"), end: ms("2026-12-01T10:30:00.000Z") },
    ]);
  });

  it("an all-day event blocks its days; one without an end an hour", () => {
    const busy = busyOfRemote(
      [
        event({
          externalId: "day",
          allDay: true,
          startsAt: "2026-12-02T23:00:00.000Z",
          endsAt: "2026-12-03T23:00:00.000Z",
        }),
        event({ externalId: "open", startsAt: "2026-12-10T09:00:00.000Z", endsAt: null }),
      ],
      new Set(),
    );
    expect(busy).toEqual([
      { start: ms("2026-12-02T23:00:00.000Z"), end: ms("2026-12-04T23:00:00.000Z") },
      { start: ms("2026-12-10T09:00:00.000Z"), end: ms("2026-12-10T10:00:00.000Z") },
    ]);
  });

  it("uses a cached read only while young enough and covering the window", () => {
    const now = ms("2026-12-01T12:00:00.000Z");
    const row = {
      fetched_at: "2026-12-01T11:58:00.000Z",
      window_from: "2026-11-30T12:00:00.000Z",
      window_to: "2027-02-01T12:00:00.000Z",
    };
    const window = { from: now, to: now + 30 * 86_400_000 };
    expect(cacheUsable(row, window, now, 5 * 60_000)).toBe(true);
    expect(cacheUsable(row, window, now, 60_000)).toBe(false);
    expect(cacheUsable(row, { from: now, to: now + 90 * 86_400_000 }, now, 5 * 60_000)).toBe(false);
    expect(cacheUsable(null, window, now, 5 * 60_000)).toBe(false);
  });

  it("keeps intervals as JSON and drops anything broken", () => {
    const list = [{ start: ms("2026-12-01T09:00:00.000Z"), end: ms("2026-12-01T10:00:00.000Z") }];
    expect(intervalsFromJson(intervalsToJson(list))).toEqual(list);
    expect(
      intervalsFromJson([
        { start: "x", end: "y" },
        null,
        { start: "2026-12-01T10:00:00Z", end: "2026-12-01T09:00:00Z" },
      ]),
    ).toEqual([]);
    expect(intervalsFromJson("nope")).toEqual([]);
  });
});
