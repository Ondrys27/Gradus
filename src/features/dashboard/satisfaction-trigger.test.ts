import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";
import { closeSurvey, surveyDue } from "./satisfaction-trigger";

const NOW = new Date("2026-10-30T12:00:00Z");
const due = (createdAt: string, lastAnswerAt: string | null = null, snoozedUntil: string | null = null) =>
  surveyDue({ createdAt, lastAnswerAt, snoozedUntil, now: NOW });

describe("surveyDue", () => {
  it("waits for fourteen full days of use", () => {
    expect(due("2026-10-17T12:00:01Z")).toBe(false);
    expect(due("2026-10-16T12:00:00Z")).toBe(true);
  });

  it("asks again thirty days after the last answer", () => {
    expect(due("2026-01-01T00:00:00Z", "2026-10-01T12:00:01Z")).toBe(false);
    expect(due("2026-01-01T00:00:00Z", "2026-09-30T12:00:00Z")).toBe(true);
  });

  it("stays hidden while a close pauses it", () => {
    expect(due("2026-01-01T00:00:00Z", null, "2026-10-30T22:00:00Z")).toBe(false);
    expect(due("2026-01-01T00:00:00Z", null, "2026-10-30T12:00:00Z")).toBe(true);
  });

  it("never asks with an unreadable sign-up date", () => {
    expect(due("nonsense")).toBe(false);
  });
});

describe("closeSurvey", () => {
  const prague = { ...DEFAULT_FORMAT_SETTINGS, timeZone: "Europe/Prague" };

  it("hides the survey until the next midnight in the user's zone", () => {
    // 30 Oct 2026, 12:00 UTC = 13:00 in Prague (winter time); midnight there is 23:00 UTC.
    expect(closeSurvey({ streak: 0, settings: prague, now: NOW })).toEqual({
      snoozedUntil: "2026-10-30T23:00:00.000Z",
      streak: 1,
      paused: false,
    });
    const tokyo = { ...DEFAULT_FORMAT_SETTINGS, timeZone: "Asia/Tokyo" };
    // 21:00 in Tokyo on the 30th; the next midnight there is 15:00 UTC on the 30th.
    expect(closeSurvey({ streak: 1, settings: tokyo, now: NOW }).snoozedUntil).toBe(
      "2026-10-30T15:00:00.000Z",
    );
  });

  it("pauses for thirty days on the third close in a row", () => {
    expect(closeSurvey({ streak: 2, settings: prague, now: NOW })).toEqual({
      snoozedUntil: "2026-11-29T12:00:00.000Z",
      streak: 0,
      paused: true,
    });
  });
});
