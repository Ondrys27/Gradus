import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS, type FormatSettings } from "@/lib/format";
import {
  activeDealFilters,
  clearDealFilter,
  countDealTasks,
  dealFiltersToSearch,
  dealMatches,
  filterDeals,
  NO_DEAL_FILTERS,
  parseDealFilters,
  type DealFilterContext,
  type DealFilters,
} from "./filters";
import type { OpenDealTask } from "./health";
import type { Deal } from "./types";

const PRAGUE: FormatSettings = {
  ...DEFAULT_FORMAT_SETTINGS,
  timeZone: "Europe/Prague",
  weekStartsOn: 1,
};
// Wednesday 4 November 2026, 10:00 in Prague (UTC+1); the week is 2.–8. 11.
const NOW = new Date("2026-11-04T09:00:00Z");
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";

const deal = (id: string, extra: Partial<Deal> = {}): Deal => ({
  id,
  contact_id: null,
  stage_id: "lead",
  title: id,
  description: null,
  value: null,
  currency: "CZK",
  expected_close_date: null,
  deadline_date: null,
  assignee_id: ME,
  created_by: ME,
  last_activity_at: "2026-11-03T10:00:00Z",
  position: 0,
  entered_stage_at: "2026-10-01T10:00:00Z",
  won_at: null,
  lost_at: null,
  lost_reason: null,
  created_at: "2026-10-01T10:00:00Z",
  contact: null,
  ...extra,
});
const won = (id: string, extra: Partial<Deal> = {}) =>
  deal(id, { won_at: "2026-10-30T08:00:00Z", ...extra });
const lost = (id: string, extra: Partial<Deal> = {}) =>
  deal(id, { lost_at: "2026-10-30T08:00:00Z", ...extra });

const task = (dealId: string, dueAt: string): OpenDealTask => ({
  id: `${dealId}-${dueAt}`,
  deal_id: dealId,
  due_at: dueAt,
  assignee_id: ME,
  deal: null,
});

function context(extra: Partial<DealFilterContext> = {}): DealFilterContext {
  return {
    now: NOW,
    settings: PRAGUE,
    userId: ME,
    tasks: new Map(),
    contactDeals: null,
    ...extra,
  };
}

const filters = (extra: Partial<DealFilters>): DealFilters => ({ ...NO_DEAL_FILTERS, ...extra });
const ids = (deals: Deal[], f: DealFilters, ctx = context()) =>
  filterDeals(deals, f, ctx).map((d) => d.id);

describe("the address", () => {
  it("reads every filter and writes it back the same", () => {
    const search =
      "?close=custom&closeFrom=2026-11-01&closeTo=2026-11-30&createdFrom=2026-10-01&idle=d14&tasks=overdue" +
      `&who=me&contact=${CONTACT}&min=1000&max=50000`;
    const parsed = parseDealFilters(new URLSearchParams(search));
    expect(parsed).toEqual({
      close: "custom",
      closeFrom: "2026-11-01",
      closeTo: "2026-11-30",
      createdFrom: "2026-10-01",
      createdTo: null,
      idle: "d14",
      idleFrom: null,
      idleTo: null,
      tasks: "overdue",
      who: "me",
      contact: CONTACT,
      min: 1000,
      max: 50000,
    });
    expect(parseDealFilters(new URLSearchParams(dealFiltersToSearch(parsed)))).toEqual(parsed);
  });

  it("ignores what it does not know and keeps other parameters", () => {
    const parsed = parseDealFilters(
      new URLSearchParams("?close=soon&tasks=x&who=bob&contact=1&min=-5&max=abc&deal=abc"),
    );
    expect(parsed).toEqual(NO_DEAL_FILTERS);
    expect(dealFiltersToSearch(parsed, new URLSearchParams("deal=abc&tile=noTask"))).toBe(
      "?deal=abc&tile=noTask",
    );
    expect(dealFiltersToSearch(NO_DEAL_FILTERS)).toBe("");
  });

  it("drops a custom range without days and puts reversed ends in order", () => {
    expect(parseDealFilters(new URLSearchParams("?close=custom")).close).toBeNull();
    const parsed = parseDealFilters(
      new URLSearchParams("?idle=custom&idleFrom=2026-11-05&idleTo=2026-11-01&min=900&max=100"),
    );
    expect(parsed).toMatchObject({
      idle: "custom",
      idleFrom: "2026-11-01",
      idleTo: "2026-11-05",
      min: 100,
      max: 900,
    });
    // Range days without the custom choice mean nothing.
    expect(parseDealFilters(new URLSearchParams("?close=past&closeFrom=2026-11-01"))).toMatchObject(
      { close: "past", closeFrom: null },
    );
  });

  it("lists and clears the active filters one by one", () => {
    const set = filters({ close: "past", min: 5, tasks: "none", createdTo: "2026-10-31" });
    expect(activeDealFilters(set)).toEqual(["close", "created", "tasks", "amount"]);
    expect(activeDealFilters(clearDealFilter(set, "amount"))).toEqual([
      "close",
      "created",
      "tasks",
    ]);
    expect(clearDealFilter(set, "created")).toMatchObject({ createdFrom: null, createdTo: null });
  });
});

describe("Close Date", () => {
  const deals = [
    deal("past", { expected_close_date: "2026-11-03" }),
    deal("today", { expected_close_date: "2026-11-04" }),
    deal("sunday", { expected_close_date: "2026-11-08" }),
    deal("nextWeek", { expected_close_date: "2026-11-09" }),
    deal("december", { expected_close_date: "2026-12-01" }),
    deal("none"),
    won("wonPast", { expected_close_date: "2026-10-20" }),
    lost("lostPast", { expected_close_date: "2026-10-20" }),
  ];

  it("in the past: open deals only, like the tile", () => {
    expect(ids(deals, filters({ close: "past" }))).toEqual(["past"]);
  });

  it("this week and this month by the user's week and zone", () => {
    expect(ids(deals, filters({ close: "thisWeek" }))).toEqual(["past", "today", "sunday"]);
    expect(ids(deals, filters({ close: "thisMonth" }))).toEqual([
      "past",
      "today",
      "sunday",
      "nextWeek",
    ]);
  });

  it("a custom range filters the won and lost columns too", () => {
    expect(
      ids(deals, filters({ close: "custom", closeFrom: "2026-10-01", closeTo: "2026-11-03" })),
    ).toEqual(["past", "wonPast", "lostPast"]);
  });
});

describe("made and last activity", () => {
  it("cuts the days the deal was made on in the user's zone", () => {
    // 23:30 UTC on 31 October is already 1 November in Prague.
    const deals = [
      deal("late", { created_at: "2026-10-31T23:30:00Z" }),
      deal("october", { created_at: "2026-10-15T10:00:00Z" }),
    ];
    expect(ids(deals, filters({ createdFrom: "2026-11-01" }))).toEqual(["late"]);
    expect(ids(deals, filters({ createdTo: "2026-10-31" }))).toEqual(["october"]);
  });

  it("finds deals without a change for more than 7, 14 or 30 days, won and lost too", () => {
    const deals = [
      deal("fresh", { last_activity_at: "2026-11-01T09:00:00Z" }),
      deal("eightDays", { last_activity_at: "2026-10-27T08:00:00Z" }),
      won("twentyDays", { last_activity_at: "2026-10-15T09:00:00Z" }),
      deal("old", { last_activity_at: "2026-09-01T09:00:00Z" }),
    ];
    expect(ids(deals, filters({ idle: "d7" }))).toEqual(["eightDays", "twentyDays", "old"]);
    expect(ids(deals, filters({ idle: "d14" }))).toEqual(["twentyDays", "old"]);
    expect(ids(deals, filters({ idle: "d30" }))).toEqual(["old"]);
    expect(
      ids(deals, filters({ idle: "custom", idleFrom: "2026-10-15", idleTo: "2026-10-27" })),
    ).toEqual(["eightDays", "twentyDays"]);
  });
});

describe("tasks", () => {
  const deals = [deal("open"), deal("late"), deal("bare"), won("wonBare"), lost("lostLate")];
  const tasks = countDealTasks(
    [
      task("open", "2026-11-10T08:00:00Z"),
      task("late", "2026-11-03T08:00:00Z"),
      task("lostLate", "2026-11-01T08:00:00Z"),
    ],
    NOW,
  );
  const ctx = context({ tasks });

  it("has an open task, or one past its due time (won and lost too)", () => {
    expect(ids(deals, filters({ tasks: "open" }), ctx)).toEqual(["open", "late", "lostLate"]);
    expect(ids(deals, filters({ tasks: "overdue" }), ctx)).toEqual(["late", "lostLate"]);
  });

  it("has none: open deals only, like the tile", () => {
    expect(ids(deals, filters({ tasks: "none" }), ctx)).toEqual(["bare"]);
  });
});

describe("who, contact and amount", () => {
  it("filters by the person who looks after the deal", () => {
    const deals = [deal("mine"), deal("theirs", { assignee_id: OTHER })];
    expect(ids(deals, filters({ who: "me" }))).toEqual(["mine"]);
    expect(ids(deals, filters({ who: OTHER }))).toEqual(["theirs"]);
  });

  it("finds a contact as the primary one or anywhere on the deal", () => {
    const deals = [deal("primary", { contact_id: CONTACT }), deal("second"), deal("none")];
    expect(ids(deals, filters({ contact: CONTACT }))).toEqual(["primary"]);
    expect(
      ids(deals, filters({ contact: CONTACT }), context({ contactDeals: new Set(["second"]) })),
    ).toEqual(["primary", "second"]);
  });

  it("keeps amounts within both ends and leaves out deals without one", () => {
    const deals = [
      deal("small", { value: 500 }),
      deal("edge", { value: 1000 }),
      deal("big", { value: 90000, currency: "EUR" }),
      deal("none"),
    ];
    expect(ids(deals, filters({ min: 1000 }))).toEqual(["edge", "big"]);
    expect(ids(deals, filters({ max: 1000 }))).toEqual(["small", "edge"]);
    expect(ids(deals, filters({ min: 600, max: 1000 }))).toEqual(["edge"]);
  });
});

describe("together", () => {
  it("combines every filter (AND)", () => {
    const deals = [
      deal("hit", { value: 2000, expected_close_date: "2026-11-01" }),
      deal("cheap", { value: 100, expected_close_date: "2026-11-01" }),
      deal("future", { value: 2000, expected_close_date: "2026-12-01" }),
      deal("other", { value: 2000, expected_close_date: "2026-11-01", assignee_id: OTHER }),
    ];
    expect(ids(deals, filters({ close: "past", min: 1000, who: "me" }))).toEqual(["hit"]);
    expect(dealMatches(deals[0]!, NO_DEAL_FILTERS, context())).toBe(true);
  });
});
