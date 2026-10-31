import { describe, expect, it } from "vitest";
import type { CrmTask } from "@/features/crm-tasks/types";
import { dealPatchSchema } from "./schemas";
import { buildDealTimeline, type TimelineInput } from "./timeline";

const DEAL: TimelineInput["deal"] = {
  id: "deal-1",
  created_at: "2026-10-01T08:00:00Z",
  created_by: "owner",
  won_at: null,
  lost_at: null,
  lost_reason: null,
  currency: "CZK",
};

function input(extra: Partial<TimelineInput> = {}): TimelineInput {
  return {
    deal: DEAL,
    events: [],
    contacts: [],
    tasks: [],
    meetings: [],
    activities: [],
    invoices: [],
    timeZone: "Europe/Prague",
    ...extra,
  };
}

function task(extra: Partial<CrmTask>): CrmTask {
  return {
    id: "task-1",
    title: "Zavolat",
    description: null,
    due_at: "2026-10-05T07:00:00Z",
    duration_minutes: 15,
    assignee_id: "owner",
    deal_id: "deal-1",
    contact_id: null,
    status: "open",
    completed_at: null,
    completed_by: null,
    completion_note: null,
    created_by: "owner",
    created_at: "2026-10-02T09:00:00Z",
    deal: null,
    contact: null,
    ...extra,
  };
}

const contact = {
  id: "c",
  company_name: "Pekárna",
  first_name: null,
  last_name: null,
  email: null,
};

describe("buildDealTimeline", () => {
  it("starts with the deal being made", () => {
    expect(buildDealTimeline(input())).toEqual([
      { key: "created", at: Date.parse(DEAL.created_at), kind: "created", actorId: "owner" },
    ]);
  });

  it("puts everything newest first, the making last at the same moment", () => {
    const entries = buildDealTimeline(
      input({
        events: [
          {
            id: "e1",
            kind: "close_date",
            payload: { from: null, to: "2026-12-15" },
            actor_id: "worker",
            occurred_at: "2026-10-03T10:00:00Z",
          },
          {
            id: "e2",
            kind: "value",
            payload: { from: 1000, to: "25000.50", from_currency: "CZK", to_currency: "EUR" },
            actor_id: "owner",
            occurred_at: "2026-10-04T10:00:00Z",
          },
        ],
        contacts: [
          // The contact the deal was made with is part of making it.
          {
            id: "l1",
            contact_id: "c",
            note: null,
            is_primary: true,
            position: 0,
            created_at: DEAL.created_at,
            created_by: "owner",
            contact,
          },
          {
            id: "l2",
            contact_id: "d",
            note: "fakturace",
            is_primary: false,
            position: 1,
            created_at: "2026-10-02T12:00:00Z",
            created_by: "owner",
            contact: {
              ...contact,
              id: "d",
              company_name: null,
              first_name: "Jan",
              last_name: "Novák",
            },
          },
        ],
        tasks: [
          task({
            status: "done",
            completed_at: "2026-10-06T08:00:00Z",
            completed_by: "worker",
            completion_note: "Pošle podklady",
          }),
        ],
        activities: [
          { id: "a1", type: "email_sent", content: "Nabídka", occurred_at: "2026-10-05T08:00:00Z" },
        ],
        meetings: [
          {
            id: "m1",
            title: "Schůzka v pekárně",
            kind: "meeting",
            starts_at: "2026-10-07T08:00:00Z",
            all_day: false,
            actor_id: "owner",
          },
        ],
      }),
    );
    expect(entries.map((entry) => entry.kind)).toEqual([
      "meeting",
      "taskDone",
      "activity",
      "value",
      "closeDate",
      "contactAdded",
      "taskCreated",
      "created",
    ]);
    expect(entries.find((entry) => entry.kind === "value")).toMatchObject({
      from: 1000,
      to: 25000.5,
      fromCurrency: "CZK",
      toCurrency: "EUR",
      actorId: "owner",
    });
    expect(entries.find((entry) => entry.kind === "contactAdded")).toMatchObject({
      name: "Jan Novák",
      note: "fakturace",
    });
    expect(entries.find((entry) => entry.kind === "closeDate")).toMatchObject({
      from: null,
      to: "2026-12-15",
      actorId: "worker",
    });
  });

  it("reads stage changes as wins and losses, with the reason", () => {
    const entries = buildDealTimeline(
      input({
        deal: { ...DEAL, lost_at: "2026-10-09T08:00:00Z", lost_reason: "Drahé" },
        events: [
          {
            id: "s1",
            kind: "stage",
            payload: { from_name: "Nový lead", to_name: "Schůzka", won: false, lost: false },
            actor_id: "owner",
            occurred_at: "2026-10-02T08:00:00Z",
          },
          {
            id: "s2",
            kind: "stage",
            payload: {
              from_name: "Schůzka",
              to_name: "Ztraceno",
              won: false,
              lost: true,
              reason: "Drahé",
            },
            actor_id: "owner",
            occurred_at: "2026-10-09T08:00:00Z",
          },
        ],
      }),
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["lost", "stage", "created"]);
    expect(entries[0]).toMatchObject({ reason: "Drahé" });
    expect(entries[1]).toMatchObject({ from: "Nový lead", to: "Schůzka" });
  });

  it("shows a win or a loss from before the log (or straight into the stage) once", () => {
    const won = buildDealTimeline(input({ deal: { ...DEAL, won_at: "2026-10-01T08:00:00Z" } }));
    expect(won.map((entry) => entry.kind)).toEqual(["won", "created"]);
    const lost = buildDealTimeline(
      input({ deal: { ...DEAL, lost_at: "2026-10-03T08:00:00Z", lost_reason: "Jiný dodavatel" } }),
    );
    expect(lost[0]).toMatchObject({ kind: "lost", reason: "Jiný dodavatel", actorId: null });
  });

  it("follows an invoice through its steps on the user's days, without its credit note", () => {
    const entries = buildDealTimeline(
      input({
        invoices: [
          {
            id: "i1",
            number: "2026-0001",
            kind: "invoice",
            status: "paid",
            issued_on: "2026-10-10",
            sent_at: "2026-10-10T09:00:00Z",
            paid_on: "2026-10-20",
            cancelled_at: null,
          },
          {
            id: "i2",
            number: "2026-0002",
            kind: "credit_note",
            status: "cancelled",
            issued_on: "2026-10-11",
            sent_at: null,
            paid_on: null,
            cancelled_at: "2026-10-11T09:00:00Z",
          },
        ],
      }),
    );
    const steps = entries.flatMap((entry) => (entry.kind === "invoice" ? [entry] : []));
    expect(steps.map((entry) => [entry.step, entry.day])).toEqual([
      ["paid", "2026-10-20"],
      ["sent", null],
      ["issued", "2026-10-10"],
    ]);
    // A date is the start of that day in the user's zone (midnight in Prague is 22:00 UTC in summer).
    expect(new Date(steps[2]!.at).toISOString()).toBe("2026-10-09T22:00:00.000Z");
  });

  it("gives an all-day meeting its day in the user's zone", () => {
    const [entry] = buildDealTimeline(
      input({
        meetings: [
          {
            id: "m",
            title: "Předání",
            kind: "deadline",
            starts_at: "2026-11-19T23:00:00Z",
            all_day: true,
            actor_id: null,
          },
        ],
      }),
    );
    expect(entry).toMatchObject({ kind: "meeting", day: "2026-11-20" });
  });
});

describe("dealPatchSchema", () => {
  it("takes one field at a time and refuses what the deal can not hold", () => {
    expect(dealPatchSchema.parse({ deadline_date: "2026-11-20" })).toEqual({
      deadline_date: "2026-11-20",
    });
    expect(dealPatchSchema.parse({ deadline_date: null })).toEqual({ deadline_date: null });
    expect(dealPatchSchema.safeParse({ title: "  " }).success).toBe(false);
    expect(dealPatchSchema.safeParse({ assignee_id: "someone" }).success).toBe(false);
    expect(dealPatchSchema.safeParse({ expected_close_date: "15. 12. 2026" }).success).toBe(false);
    expect(dealPatchSchema.safeParse({ value: -1 }).success).toBe(false);
  });
});
