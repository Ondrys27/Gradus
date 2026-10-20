import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";
import { mentionHref, optionFromHit } from "./mention-queries";

const ID = "0b7c1f7e-4a53-4c4e-9f3e-2f1a9b8c7d61";

describe("mentionHref", () => {
  const settings = { ...DEFAULT_FORMAT_SETTINGS, timeZone: "Europe/Prague" };

  it("opens each record where its detail lives", () => {
    expect(mentionHref("contact", ID, settings)).toBe(`/app/kontakty/${ID}`);
    expect(mentionHref("deal", ID, settings)).toBe(`/app/pipeline?deal=${ID}`);
    expect(mentionHref("worker", ID, settings)).toBe(`/app/pracovnici/${ID}`);
  });

  it("opens an event on its day in the user's time zone", () => {
    // 23:30 UTC is already the next day in Prague.
    expect(mentionHref("event", ID, settings, "2026-10-20T23:30:00Z")).toBe(
      `/app/kalendar?event=${ID}&date=2026-10-21`,
    );
    expect(mentionHref("event", ID, settings)).toBe(`/app/kalendar?event=${ID}`);
  });
});

describe("optionFromHit", () => {
  it("keeps the four kinds a note can mention, with a helpful second line", () => {
    expect(
      optionFromHit({
        kind: "contact",
        id: ID,
        title: "Pekárna s.r.o.",
        rank: 2,
        data: { company: "Pekárna s.r.o.", person: "Jan Novák", table: "Leady" },
      }),
    ).toEqual({ type: "contact", id: ID, label: "Pekárna s.r.o.", startsAt: null, detail: "Jan Novák" });
    expect(
      optionFromHit({ kind: "event", id: ID, title: "Schůzka", rank: 1, data: { startsAt: "2026-10-21T08:00:00Z" } }),
    ).toMatchObject({ type: "event", startsAt: "2026-10-21T08:00:00Z", detail: null });
    expect(optionFromHit({ kind: "task", id: ID, title: "Úkol", rank: 1, data: {} })).toBeNull();
    expect(optionFromHit({ kind: "deal", id: ID, title: "  ", rank: 1, data: {} })).toBeNull();
  });
});
