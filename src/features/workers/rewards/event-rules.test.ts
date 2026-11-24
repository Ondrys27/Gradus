import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_CATALOG, eventsByGroup, REWARD_EVENTS } from "./catalog";
import {
  definitionErrors,
  legacyDefinition,
  missingRefs,
  newDefinition,
  normalizeDefinition,
  overlappingPairs,
  parseDefinition,
  rulesOverlap,
  tierAmount,
  tiersOk,
  type RuleDefinition,
} from "./definition";
import { bonusProgress, ruleMatches, ruleAmount, simulate, type EventSubject } from "./evaluate";

const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20261205090000_reward_event_rules.sql"),
  "utf8",
);

const T = {
  unreached: "00000000-0000-4000-8000-000000000001",
  noAnswer: "00000000-0000-4000-8000-000000000002",
  meeting: "00000000-0000-4000-8000-000000000003",
  followUp: "00000000-0000-4000-8000-000000000004",
  interested: "00000000-0000-4000-8000-000000000005",
};
const CTX = { planCurrency: "CZK", timeZone: "Europe/Prague" };

let seq = 0;
function subject(partial: Partial<EventSubject> & Pick<EventSubject, "event">): EventSubject {
  seq += 1;
  return {
    at: `2026-11-${String(10 + Math.floor(seq / 50)).padStart(2, "0")}T10:${String(seq % 60).padStart(2, "0")}:00.000Z`,
    source_kind: "contact_move",
    source_id: `s${seq}`,
    subject_id: "c1",
    did: true,
    on_record: true,
    ...partial,
  };
}

function anyToMeeting(amount: number): RuleDefinition {
  const definition = newDefinition("contact.moved", amount);
  definition.event.to = { mode: "only", ids: [T.meeting] };
  return definition;
}

describe("the catalog", () => {
  it("every event has a group, a who and a reward, and the database knows the same events", () => {
    for (const event of REWARD_EVENTS) {
      const spec = EVENT_CATALOG[event];
      expect(spec.who.length).toBeGreaterThan(0);
      expect(spec.rewards.length).toBeGreaterThan(0);
      expect(MIGRATION).toContain(`'${event}'`);
    }
    expect(eventsByGroup().flatMap((group) => group.events).sort()).toEqual([...REWARD_EVENTS].sort());
  });

  it("the database's default who is the catalog's first", () => {
    const record = REWARD_EVENTS.filter((event) => EVENT_CATALOG[event].who[0] === "record").sort();
    const sql = MIGRATION.match(/when _event in \(([^)]*)\) then 'record'/)?.[1] ?? "";
    expect(sql.split(",").map((item) => item.trim().replace(/'/g, "")).sort()).toEqual(record);
  });
});

describe("a definition", () => {
  it("a new rule: from anywhere, the first time only, cancelled when moved back", () => {
    expect(newDefinition("contact.moved", 500)).toEqual({
      event: { key: "contact.moved", from: { mode: "any", ids: [] }, to: { mode: "only", ids: [] } },
      conditions: { once: true },
      reward: { type: "fixed", amount: 500 },
      limits: {},
      stack: "sum",
      undo: "cancel",
    });
    expect(newDefinition("time.hour", 300).reward).toEqual({ type: "unit", amount: 300 });
  });

  it("keeps only what the event uses", () => {
    const messy = {
      event: { key: "deal.won", from: { mode: "only", ids: [T.meeting] }, via: ["calls"], onTime: true },
      conditions: { who: "record", value: { min: 1000.555 }, tags: [" VIP ", "VIP", ""], once: true },
      reward: { type: "percent", percent: 5.555 },
      limits: { cap: 30000, bonus: { count: 10, amount: 5000 } },
      stack: "max",
      undo: "keep",
    } as unknown as RuleDefinition;
    expect(normalizeDefinition(messy)).toEqual({
      event: { key: "deal.won" },
      conditions: { value: { min: 1000.56 }, tags: ["VIP"] },
      reward: { type: "percent", percent: 5.56 },
      limits: { cap: 30000, bonus: { count: 10, amount: 5000 } },
      stack: "max",
      undo: "cancel",
    });
    // A reward the event does not have falls back to a fixed amount.
    expect(normalizeDefinition({ ...newDefinition("deal.lost"), reward: { type: "price" } }).reward).toEqual({
      type: "fixed",
      amount: 0,
    });
    expect(parseDefinition({ hello: 1 })).toBeNull();
  });

  it("checks amounts, tiers, ranges, tables and dates like the database", () => {
    expect(definitionErrors(anyToMeeting(0))).toEqual(["amountInvalid"]);
    expect(definitionErrors(newDefinition("contact.moved", 10))).toEqual(["toEmpty"]);
    expect(
      definitionErrors({ ...newDefinition("deal.won", 10), conditions: { value: { min: 5000, max: 100 } } }),
    ).toEqual(["valueInvalid"]);
    expect(
      definitionErrors({ ...anyToMeeting(10), conditions: { window: { from: "2026-12-01", to: "2026-11-01" } } }),
    ).toEqual(["windowInvalid"]);
    expect(definitionErrors({ ...anyToMeeting(10), limits: { bonus: { count: 0, amount: 100 } } })).toEqual([
      "bonusInvalid",
    ]);
    expect(tiersOk([{ from: 1, amount: 500 }, { from: 11, amount: 800 }])).toBe(true);
    expect(tiersOk([{ from: 2, amount: 500 }, { from: 11, amount: 800 }])).toBe(false);
    expect(tiersOk([{ from: 1, amount: 500 }])).toBe(false);
    expect(tierAmount([{ from: 1, amount: 500 }, { from: 11, amount: 800 }], 10)).toBe(500);
    expect(tierAmount([{ from: 1, amount: 500 }, { from: 11, amount: 800 }], 11)).toBe(800);
  });

  it("a rule whose table is gone needs an edit; a renamed one does not", () => {
    const refs = { tables: [{ id: T.meeting, name: "Schůzky (přejmenované)", system_key: null }], stages: [] };
    expect(missingRefs(anyToMeeting(10), refs)).toEqual([]);
    expect(missingRefs({ ...anyToMeeting(10), event: { ...anyToMeeting(10).event, from: { mode: "only", ids: [T.unreached] } } }, refs)).toEqual([T.unreached]);
  });

  it("warns about two rules that can pay the same event", () => {
    const meeting = anyToMeeting(500);
    const interested = { ...anyToMeeting(100), event: { ...anyToMeeting(100).event, to: { mode: "only" as const, ids: [T.interested] } } };
    const anywhere = { ...anyToMeeting(5), event: { ...anyToMeeting(5).event, to: { mode: "any" as const, ids: [] } } };
    expect(rulesOverlap(meeting, interested)).toBe(false);
    expect(rulesOverlap(meeting, anywhere)).toBe(true);
    expect(rulesOverlap(meeting, newDefinition("deal.won", 5))).toBe(false);
    const price = { ...newDefinition("task.done"), reward: { type: "price" as const } };
    expect(rulesOverlap(price, newDefinition("task.done", 100))).toBe(false);
    const rules = [
      { id: "a", active: true, definition: meeting },
      { id: "b", active: true, definition: anywhere },
      { id: "c", active: false, definition: anyToMeeting(1) },
    ];
    expect(overlappingPairs(rules).map(([x, y]) => `${x.id}${y.id}`)).toEqual(["ab"]);
  });
});

describe("the kinds of 28.2", () => {
  const tables = { unreached: T.unreached, no_answer: T.noAnswer, interested: T.interested, meeting_scheduled: T.meeting };
  const legacy = (kind: Parameters<typeof legacyDefinition>[0]["kind"], extra: Partial<Parameters<typeof legacyDefinition>[0]> = {}) =>
    legacyDefinition({ kind, amount: 100, percent: null, filter: {}, cap_per_period: null, ...extra }, tables);

  it("become events with the conditions they always had, and the database agrees", () => {
    expect(legacy("per_meeting", { cap_per_period: 3000 })).toEqual({
      event: { key: "meeting.booked", via: ["calls", "scheduler"] },
      conditions: { once: true },
      reward: { type: "fixed", amount: 100 },
      limits: { cap: 3000 },
      stack: "sum",
      undo: "keep",
    });
    expect(legacy("per_call").event).toEqual({
      key: "contact.moved",
      from: { mode: "only", ids: [T.unreached, T.noAnswer] },
      to: { mode: "any", ids: [] },
    });
    expect(legacy("per_contact").event.to).toEqual({ mode: "only", ids: [T.interested, T.meeting] });
    expect(legacy("deal_percent", { amount: null, percent: 5, filter: { minDealValue: 10000 } })).toMatchObject({
      event: { key: "deal.won" },
      conditions: { value: { min: 10000 } },
      reward: { type: "percent", percent: 5 },
    });
    expect(legacy("task_fixed", { amount: null, filter: { onTimeOnly: true } })).toMatchObject({
      event: { key: "task.done", onTime: true },
      reward: { type: "price" },
    });
    expect(legacy("monthly_fixed").event.key).toBe("time.month");
    // The SQL twin builds the same shapes (spot checks of its text).
    expect(MIGRATION).toContain(`'{"key": "meeting.booked", "via": ["calls", "scheduler"]}'`);
    expect(MIGRATION).toContain(`t.system_key in ('unreached', 'no_answer')`);
    expect(MIGRATION).toContain(`t.system_key in ('interested', 'meeting_scheduled')`);
  });

  it("pay the same events as before: a call per move out of Not contacted, a contact and a meeting once", () => {
    const call = legacy("per_call", { amount: 10 });
    const contact = legacy("per_contact", { amount: 100 });
    const moves = [
      subject({ event: "contact.moved", from_id: T.unreached, to_id: T.meeting }),
      subject({ event: "contact.moved", from_id: T.meeting, to_id: T.followUp }),
      subject({ event: "contact.moved", from_id: T.followUp, to_id: T.meeting }),
      subject({ event: "contact.moved", from_id: T.noAnswer, to_id: T.interested, subject_id: "c2" }),
    ];
    expect(simulate(call, moves, CTX).count).toBe(2);
    // Moving back kept a reward then ("keep"): still once per contact.
    expect(simulate(contact, moves, CTX).count).toBe(2);
  });
});

describe("conditions", () => {
  it("who did it: the worker, or anyone on the worker's record", () => {
    const won = newDefinition("deal.won", 500);
    const event = subject({ event: "deal.won", did: true, on_record: false, value: 1000, currency: "CZK" });
    expect(ruleMatches(won, event, CTX)).toBe(false);
    expect(ruleMatches({ ...won, conditions: { who: "self" } }, event, CTX)).toBe(true);
  });

  it("from any, only or except some tables, into the chosen ones", () => {
    const rule = (from: RuleDefinition["event"]["from"]) => ({ ...anyToMeeting(1), event: { ...anyToMeeting(1).event, from } });
    const fromFollowUp = subject({ event: "contact.moved", from_id: T.followUp, to_id: T.meeting });
    expect(ruleMatches(rule({ mode: "any", ids: [] }), fromFollowUp, CTX)).toBe(true);
    expect(ruleMatches(rule({ mode: "only", ids: [T.unreached] }), fromFollowUp, CTX)).toBe(false);
    expect(ruleMatches(rule({ mode: "except", ids: [T.followUp] }), fromFollowUp, CTX)).toBe(false);
    expect(ruleMatches(rule({ mode: "except", ids: [T.unreached] }), fromFollowUp, CTX)).toBe(true);
    expect(ruleMatches(anyToMeeting(1), { ...fromFollowUp, to_id: T.interested }, CTX)).toBe(false);
  });

  it("the value range in the plan's currency, contact tags, dates, sources, kinds of task", () => {
    const ranged = { ...newDefinition("deal.won", 1), conditions: { value: { min: 10000, max: 50000 } } };
    expect(ruleMatches(ranged, subject({ event: "deal.won", value: 20000, currency: "CZK" }), CTX)).toBe(true);
    expect(ruleMatches(ranged, subject({ event: "deal.won", value: 20000, currency: "EUR" }), CTX)).toBe(false);
    expect(ruleMatches(ranged, subject({ event: "deal.won", value: 60000, currency: "CZK" }), CTX)).toBe(false);

    const tagged = { ...anyToMeeting(1), conditions: { once: true, tags: ["vip"] } };
    expect(ruleMatches(tagged, subject({ event: "contact.moved", to_id: T.meeting, tags: ["VIP", "Praha"] }), CTX)).toBe(true);
    expect(ruleMatches(tagged, subject({ event: "contact.moved", to_id: T.meeting, tags: [] }), CTX)).toBe(false);

    const windowed = { ...anyToMeeting(1), conditions: { window: { from: "2026-12-01" } } };
    expect(ruleMatches(windowed, subject({ event: "contact.moved", to_id: T.meeting, at: "2026-11-30T23:30:00.000Z" }), CTX)).toBe(true);
    expect(ruleMatches(windowed, subject({ event: "contact.moved", to_id: T.meeting, at: "2026-11-30T22:30:00.000Z" }), CTX)).toBe(false);

    const scheduler = { ...newDefinition("meeting.booked", 1), event: { key: "meeting.booked" as const, via: ["scheduler" as const] } };
    expect(ruleMatches(scheduler, subject({ event: "meeting.booked", via: "calls" }), CTX)).toBe(false);
    expect(ruleMatches(scheduler, subject({ event: "meeting.booked", via: "scheduler" }), CTX)).toBe(true);

    const salesTasks = { ...newDefinition("task.done", 50), event: { key: "task.done" as const, taskKinds: ["crm_task" as const], onTime: true } };
    expect(ruleMatches(salesTasks, subject({ event: "task.done", task_kind: "crm_task", on_time: true, priced: false }), CTX)).toBe(true);
    expect(ruleMatches(salesTasks, subject({ event: "task.done", task_kind: "crm_task", on_time: false, priced: false }), CTX)).toBe(false);
    expect(ruleMatches(salesTasks, subject({ event: "task.done", task_kind: "task", on_time: true, priced: false }), CTX)).toBe(false);
    // A task with its own price is paid by its price, not by a fixed amount.
    expect(ruleMatches(salesTasks, subject({ event: "task.done", task_kind: "crm_task", on_time: true, priced: true }), CTX)).toBe(false);

    const phone = { ...newDefinition("contact.created", 30), event: { key: "contact.created" as const, require: "phone" as const } };
    expect(ruleMatches(phone, subject({ event: "contact.created", has_phone: false, has_email: true }), CTX)).toBe(false);
    expect(ruleMatches(phone, subject({ event: "contact.created", has_phone: true }), CTX)).toBe(true);
  });
});

describe("amounts", () => {
  it("a share of the value in its currency, per hour, the task's price", () => {
    const share = { ...newDefinition("deal.won"), reward: { type: "percent" as const, percent: 3 }, limits: { cap: 30000 } };
    expect(ruleAmount(share, subject({ event: "deal.won", value: 123456, currency: "EUR" }), CTX, 1)).toEqual({
      amount: 3703.68,
      currency: "EUR",
      cap: null,
    });
    expect(ruleAmount(share, subject({ event: "deal.won", value: 0, currency: "CZK" }), CTX, 1)).toBeNull();
    expect(ruleAmount(newDefinition("time.hour", 300), subject({ event: "time.hour", units: 1.5 }), CTX, 1)?.amount).toBe(450);
    const price = { ...newDefinition("task.done"), reward: { type: "price" as const } };
    expect(ruleAmount(price, subject({ event: "task.done", price: 700, price_currency: "EUR" }), CTX, 1)).toEqual({
      amount: 700,
      currency: "EUR",
      cap: null,
    });
  });
});

describe("a dry run", () => {
  it("only the first time per contact; moving back cancels and moving again pays once", () => {
    const moves = [
      subject({ event: "contact.moved", from_id: T.followUp, to_id: T.meeting, note: "Kavárna" }),
      subject({ event: "contact.moved", from_id: T.meeting, to_id: T.followUp }),
      subject({ event: "contact.moved", from_id: T.followUp, to_id: T.meeting, note: "Kavárna" }),
      subject({ event: "contact.moved", from_id: T.meeting, to_id: T.meeting }),
    ];
    const result = simulate(anyToMeeting(500), moves, CTX);
    expect(result.count).toBe(1);
    expect(result.totals).toEqual([{ currency: "CZK", amount: 500 }]);
    // Every time: back cancels, again pays.
    const everyTime = { ...anyToMeeting(500), conditions: { once: false } };
    expect(simulate(everyTime, moves, CTX).count).toBe(2);
    // Keeping it when moved back: once is once.
    expect(simulate({ ...anyToMeeting(500), undo: "keep" }, moves, CTX).count).toBe(1);
  });

  it("tiers by the month's count, a cap and a bonus at a count", () => {
    const rule: RuleDefinition = {
      ...anyToMeeting(0),
      reward: { type: "tiers", tiers: [{ from: 1, amount: 500 }, { from: 3, amount: 800 }] },
      limits: { cap: 2500, bonus: { count: 3, amount: 5000 } },
    };
    const moves = ["a", "b", "c", "d"].map((id) => subject({ event: "contact.moved", to_id: T.meeting, subject_id: id }));
    const result = simulate(rule, moves, CTX);
    expect(result.first.map((entry) => [entry.amount, entry.bonus])).toEqual([
      [500, false],
      [500, false],
      [800, false],
      [5000, true],
      [700, false],
    ]);
    expect(result.count).toBe(4);
    expect(result.totals).toEqual([{ currency: "CZK", amount: 7500 }]);
  });

  it("shows where a bonus stands this month", () => {
    const rule = { ...anyToMeeting(500), limits: { bonus: { count: 10, amount: 5000 } } };
    const entries = Array.from({ length: 7 }, () => ({
      rule_id: "r",
      source_kind: "contact_move",
      amount: 500,
      status: "approved",
      corrects_id: null,
    }));
    expect(bonusProgress(rule, [...entries, { ...entries[0]!, rule_id: "x" }], "r")).toEqual({ done: 7, goal: 10, reached: false });
    expect(bonusProgress(anyToMeeting(5), entries, "r")).toBeNull();
  });
});
