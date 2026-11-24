import { describe, expect, it } from "vitest";
import {
  activityFiltersSearch,
  activityHref,
  actorsFor,
  dailyByDay,
  parseActivityFilters,
  periodRange,
  sentenceKey,
  summaryOf,
} from "./activity";

const P = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";

describe("company activity", () => {
  it("reads the filters from the address and leaves defaults out of it", () => {
    const filters = parseActivityFilters(
      new URLSearchParams(`tab=activity&person=${P}&kind=deal&period=month&group=nope`),
    );
    expect(filters).toEqual({ person: P, group: null, kind: "deal", period: "month" });
    expect(parseActivityFilters(new URLSearchParams("kind=x")).period).toBe("week");
    expect(
      activityFiltersSearch(new URLSearchParams("tab=activity&period=month"), {
        period: "week",
        person: P,
      }),
    ).toBe(`tab=activity&person=${P}`);
  });

  it("counts a period in the user's days, never UTC", () => {
    const range = periodRange("week", "2026-11-24", "Europe/Prague");
    expect(range.firstDay).toBe("2026-11-18");
    expect(range.from).toBe("2026-11-17T23:00:00.000Z");
    expect(range.until).toBe("2026-11-24T23:00:00.000Z");
    expect(periodRange("today", "2026-11-24", "Europe/Prague").firstDay).toBe("2026-11-24");
  });

  it("asks for one person, a group's members, or everyone the viewer sees", () => {
    const people = [
      { userId: "a", groupIds: [G] },
      { userId: null, groupIds: [G] },
      { userId: "b", groupIds: [] },
    ];
    expect(actorsFor({ person: P, group: null }, people)).toEqual([P]);
    expect(actorsFor({ person: null, group: G }, people)).toEqual(["a"]);
    expect(actorsFor({ person: null, group: null }, people)).toBeNull();
  });

  it("knows its sentences and links; a deleted record links nowhere", () => {
    expect(sentenceKey({ object_kind: "deal", verb: "won" })).toBe("deal.won");
    expect(sentenceKey({ object_kind: "deal", verb: "exploded" })).toBe("other");
    expect(activityHref({ object_kind: "deal", object_id: "d1", verb: "won" })).toBe(
      "/app/pipeline?deal=d1",
    );
    expect(activityHref({ object_kind: "deal", object_id: "d1", verb: "deleted" })).toBeNull();
    expect(activityHref({ object_kind: "task", object_id: "t", verb: "completed" })).toBeNull();
  });

  it("reads a summary the database may have blanked", () => {
    expect(summaryOf({ title: "Web", amount: "25000.00", currency: "CZK" })).toMatchObject({
      title: "Web",
      amount: 25000,
      currency: "CZK",
      stage: null,
    });
    expect(summaryOf({})).toMatchObject({ title: null, amount: null });
  });

  it("groups each person's day, newest day first and the busiest person first", () => {
    const row = (actor: string, day: string, total: number) => ({
      actor_id: actor,
      day,
      tasks: 0,
      deals: 0,
      calls: total,
      meetings: 0,
      total,
    });
    const days = dailyByDay([
      row("a", "2026-11-23", 1),
      row("b", "2026-11-24", 2),
      row("a", "2026-11-24", 5),
    ]);
    expect(days.map((day) => day.day)).toEqual(["2026-11-24", "2026-11-23"]);
    expect(days[0].people.map((person) => person.actor_id)).toEqual(["a", "b"]);
  });
});
