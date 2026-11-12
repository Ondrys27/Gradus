import { describe, expect, it, vi } from "vitest";
import { planUndo, type CurrentRow, type UndoRecord } from "./records";

vi.mock("server-only", () => ({}));

const T1 = "2026-11-12T10:00:00.000Z";
const T2 = "2026-11-12T10:05:00.000Z";

function rows(map: Record<string, CurrentRow>) {
  return (record: UndoRecord) => map[`${record.table}:${record.match.id}`] ?? null;
}

describe("undo of Grady's changes", () => {
  it("deletes what it created, newest first, when nothing changed since", () => {
    const records: UndoRecord[] = [
      { table: "milestones", match: { id: "m" }, op: "insert", stamp: T1 },
      { table: "tasks", match: { id: "a" }, op: "insert", stamp: T1 },
      { table: "tasks", match: { id: "b" }, op: "insert", stamp: T1 },
    ];
    const plan = planUndo(
      records,
      rows({
        "milestones:m": { updated_at: T1 },
        "tasks:a": { updated_at: T1 },
        "tasks:b": { updated_at: T1 },
      }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.steps.map((step) => `${step.kind}:${step.record.match.id}`)).toEqual([
      "delete:b",
      "delete:a",
      "delete:m",
    ]);
  });

  it("writes the values from before back (snapshot before → after)", () => {
    const record: UndoRecord = {
      table: "deals",
      match: { id: "d" },
      op: "update",
      before: { title: "Old", value: 100 },
      after: { title: "New", value: 200 },
      stamp: T1,
    };
    const plan = planUndo(
      [record],
      rows({ "deals:d": { updated_at: "2026-11-12T10:00:00+00:00" } }),
    );
    expect(plan).toEqual({
      ok: true,
      steps: [{ kind: "restore", record, values: { title: "Old", value: 100 } }],
    });
  });

  it("refuses when the record changed since in another way, and changes nothing", () => {
    const records: UndoRecord[] = [
      { table: "tasks", match: { id: "a" }, op: "insert", stamp: T1 },
      { table: "tasks", match: { id: "b" }, op: "update", before: { status: "todo" }, stamp: T1 },
    ];
    const plan = planUndo(
      records,
      rows({ "tasks:a": { updated_at: T1 }, "tasks:b": { updated_at: T2 } }),
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe("changed");
    expect(plan.record.match.id).toBe("b");
  });

  it("an updated record that is gone can not be restored", () => {
    const plan = planUndo(
      [
        {
          table: "contacts",
          match: { id: "c" },
          op: "update",
          before: { city: "Brno" },
          stamp: T1,
        },
      ],
      rows({}),
    );
    expect(plan).toMatchObject({ ok: false, reason: "gone" });
  });

  it("a created record already gone (deleted with its parent) is simply skipped", () => {
    const plan = planUndo(
      [{ table: "tasks", match: { id: "a" }, op: "insert", stamp: T1 }],
      rows({}),
    );
    expect(plan).toMatchObject({ ok: true, steps: [{ kind: "skip" }] });
  });

  it("a table without updated_at compares the fields the change left", () => {
    const record: UndoRecord = {
      table: "note_links",
      match: { id: "l" },
      op: "insert",
      stamp: null,
    };
    expect(planUndo([record], rows({ "note_links:l": { id: "l" } })).ok).toBe(true);
    const changed: UndoRecord = {
      table: "worker_group_members",
      match: { id: "g" },
      op: "update",
      before: { worker_id: "w1" },
      after: { worker_id: "w2" },
      stamp: null,
    };
    expect(
      planUndo([changed], rows({ "worker_group_members:g": { worker_id: "w3" } })),
    ).toMatchObject({
      ok: false,
      reason: "changed",
    });
  });
});
