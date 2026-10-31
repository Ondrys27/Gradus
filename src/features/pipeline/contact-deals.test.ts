import { describe, expect, it } from "vitest";
import {
  dealOutcome,
  dealTitleFor,
  newestOpenDealByContact,
  offersDeal,
  openStages,
  sortContactDeals,
  startingStageId,
  summarizeContactDeals,
} from "./contact-deals";
import { TITLE_MAX } from "./schemas";

const stages = [
  { id: "won", position: 4, is_won: true, is_lost: false },
  { id: "lead", position: 0, is_won: false, is_lost: false },
  { id: "lost", position: 5, is_won: false, is_lost: true },
  { id: "meeting", position: 1, is_won: false, is_lost: false },
];

function deal(
  id: string,
  extra: Partial<{
    value: number | null;
    currency: string;
    last_activity_at: string;
    won_at: string | null;
    lost_at: string | null;
    created_at: string;
  }> = {},
) {
  return {
    id,
    title: id,
    value: null,
    currency: "CZK",
    last_activity_at: "2026-10-01T08:00:00Z",
    won_at: null,
    lost_at: null,
    created_at: "2026-09-01T08:00:00Z",
    ...extra,
  };
}

describe("where a deal from a contact starts", () => {
  it("offers a deal after Domluvená schůzka and Klient má zájem only", () => {
    expect(offersDeal("meeting_scheduled")).toBe(true);
    expect(offersDeal("interested")).toBe(true);
    expect(offersDeal("email_sent")).toBe(false);
    expect(offersDeal(null)).toBe(false);
    expect(offersDeal(undefined)).toBe(false);
  });

  it("starts only in open stages, in board order", () => {
    expect(openStages(stages).map((stage) => stage.id)).toEqual(["lead", "meeting"]);
  });

  it("takes the stage picked in the settings, else the first open one", () => {
    expect(startingStageId(stages, "meeting")).toBe("meeting");
    expect(startingStageId(stages, null)).toBe("lead");
    // A stage removed since, or turned into won or lost, falls back.
    expect(startingStageId(stages, "gone")).toBe("lead");
    expect(startingStageId(stages, "won")).toBe("lead");
    expect(startingStageId([], "meeting")).toBeNull();
  });

  it("names the deal after the company, else the person", () => {
    expect(dealTitleFor({ company_name: "Pekárna Dub", first_name: "Jana", last_name: "Nová" })).toBe(
      "Pekárna Dub",
    );
    expect(dealTitleFor({ company_name: null, first_name: "Jana", last_name: "Nová" })).toBe(
      "Jana Nová",
    );
    expect(
      dealTitleFor({ company_name: "x".repeat(TITLE_MAX + 30), first_name: null, last_name: null }),
    ).toHaveLength(TITLE_MAX);
  });
});

describe("a contact's deals", () => {
  it("lists open deals first by last activity, then the won and lost ones newest first", () => {
    const sorted = sortContactDeals([
      deal("lost-old", { lost_at: "2026-03-01T08:00:00Z" }),
      deal("open-quiet", { last_activity_at: "2026-09-02T08:00:00Z" }),
      deal("won-new", { won_at: "2026-10-20T08:00:00Z" }),
      deal("open-busy", { last_activity_at: "2026-10-30T08:00:00Z" }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual([
      "open-busy",
      "open-quiet",
      "won-new",
      "lost-old",
    ]);
  });

  it("tells won from lost with the date", () => {
    expect(dealOutcome(deal("a", { won_at: "2026-10-20T08:00:00Z" }))).toEqual({
      kind: "won",
      at: "2026-10-20T08:00:00Z",
    });
    expect(dealOutcome(deal("b", { lost_at: "2026-10-21T08:00:00Z" }))?.kind).toBe("lost");
    expect(dealOutcome(deal("c"))).toBeNull();
  });

  it("sums open and won values per currency, never across them", () => {
    const summary = summarizeContactDeals([
      deal("a", { value: 10000.1, currency: "CZK" }),
      deal("b", { value: 5000.2, currency: "CZK" }),
      deal("c", { value: 300, currency: "EUR" }),
      deal("d", { value: null }),
      deal("e", { value: 20000, won_at: "2026-10-20T08:00:00Z" }),
      deal("f", { value: 999, lost_at: "2026-10-21T08:00:00Z" }),
    ]);
    expect(summary).toEqual({
      openCount: 4,
      openValue: [
        { currency: "CZK", total: 15000.3 },
        { currency: "EUR", total: 300 },
      ],
      wonCount: 1,
      wonValue: [{ currency: "CZK", total: 20000 }],
    });
  });

  it("has nothing to sum without deals", () => {
    expect(summarizeContactDeals([])).toEqual({
      openCount: 0,
      openValue: [],
      wonCount: 0,
      wonValue: [],
    });
  });
});

describe("the open deal linked from a Cold Calling row", () => {
  it("is the newest open deal of each contact", () => {
    const byContact = newestOpenDealByContact([
      { contact_id: "c1", deal: { id: "d1", title: "Starší", created_at: "2026-09-01T08:00:00Z" } },
      { contact_id: "c1", deal: { id: "d2", title: "Novější", created_at: "2026-10-01T08:00:00Z" } },
      { contact_id: "c2", deal: { id: "d3", title: "Jediný", created_at: "2026-08-01T08:00:00Z" } },
      { contact_id: "c3", deal: null },
    ]);
    expect(byContact).toEqual({
      c1: { id: "d2", title: "Novější" },
      c2: { id: "d3", title: "Jediný" },
    });
  });
});
