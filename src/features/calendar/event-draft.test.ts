import { describe, expect, it } from "vitest";
import { draftFromEvent, emptyDraft, validateDraft, withAllDay } from "./event-draft";
import type { CalendarEvent } from "./types";

const PRAGUE = "Europe/Prague";

describe("event draft", () => {
  it("starts at nine in the user's zone, one hour long", () => {
    const draft = emptyDraft("2026-09-25", PRAGUE);
    expect(draft.startsAt).toBe("2026-09-25T07:00:00.000Z");
    expect(draft.endsAt).toBe("2026-09-25T08:00:00.000Z");
  });

  it("takes the range picked on the axis", () => {
    const draft = emptyDraft("2026-09-25", PRAGUE, {
      starts_at: "2026-09-25T12:00:00.000Z",
      ends_at: "2026-09-25T12:45:00.000Z",
    });
    expect(draft.startsAt).toBe("2026-09-25T12:00:00.000Z");
    expect(draft.endsAt).toBe("2026-09-25T12:45:00.000Z");
  });

  it("requires a title and an end after the start", () => {
    const draft = emptyDraft("2026-09-25", PRAGUE);
    const blank = validateDraft(draft, PRAGUE);
    expect(blank).toEqual({ ok: false, errors: { title: "titleRequired" } });
    const backwards = validateDraft({ ...draft, title: "x", endsAt: draft.startsAt }, PRAGUE);
    expect(backwards).toEqual({ ok: false, errors: { ends_at: "endBeforeStart" } });
    expect(validateDraft({ ...draft, title: "x" }, PRAGUE).ok).toBe(true);
  });

  it("stores an all-day event at the user's midnight, with an end only when it spans days", () => {
    const base = withAllDay({ ...emptyDraft("2026-09-25", PRAGUE), title: "Fair" }, true, PRAGUE);
    const single = validateDraft(base, PRAGUE);
    expect(single).toMatchObject({
      ok: true,
      data: { all_day: true, starts_at: "2026-09-24T22:00:00.000Z", ends_at: null },
    });
    const multi = validateDraft({ ...base, endDate: "2026-09-27" }, PRAGUE);
    expect(multi).toMatchObject({ ok: true, data: { ends_at: "2026-09-26T22:00:00.000Z" } });
    expect(validateDraft({ ...base, endDate: "2026-09-20" }, PRAGUE)).toEqual({
      ok: false,
      errors: { ends_at: "endBeforeStart" },
    });
  });

  it("round-trips an all-day event through the form", () => {
    const stored = {
      id: "e",
      title: "Fair",
      description: "Booth 4",
      kind: "deadline",
      starts_at: "2026-09-24T22:00:00.000Z",
      ends_at: "2026-09-26T22:00:00.000Z",
      all_day: true,
      contact_id: null,
      deal_id: null,
      source: "manual",
      contact: null,
      deal: null,
    } satisfies CalendarEvent;
    const draft = draftFromEvent(stored, PRAGUE);
    expect([draft.startDate, draft.endDate]).toEqual(["2026-09-25", "2026-09-27"]);
    const result = validateDraft(draft, PRAGUE);
    expect(result).toMatchObject({
      ok: true,
      data: { starts_at: stored.starts_at, ends_at: stored.ends_at, kind: "deadline" },
    });
  });

  it("carries the day over when switching between all-day and timed", () => {
    const timed = { ...emptyDraft("2026-09-25", PRAGUE), title: "x" };
    const allDay = withAllDay(timed, true, PRAGUE);
    expect(allDay.startDate).toBe("2026-09-25");
    const back = withAllDay(allDay, false, PRAGUE);
    expect(back.startsAt).toBe("2026-09-25T07:00:00.000Z");
  });
});
