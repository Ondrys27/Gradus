import { describe, expect, it } from "vitest";
import {
  assigneeChange,
  canSaveAssignees,
  dealAssigneeIds,
  isOnDeal,
  nextAssignees,
} from "./assignees";

const row = (assignee_id: string, created_at: string) => ({ assignee_id, created_at });

describe("dealAssigneeIds", () => {
  it("lists everyone on the deal, longest-serving first", () => {
    expect(
      dealAssigneeIds({
        assignee_id: "a",
        assignees: [row("c", "2026-11-03T00:00:00Z"), row("a", "2026-11-01T00:00:00Z")],
      }),
    ).toEqual(["a", "c"]);
  });

  it("falls back to the mirror without the list", () => {
    expect(dealAssigneeIds({ assignee_id: "a" })).toEqual(["a"]);
    expect(dealAssigneeIds({ assignee_id: null, assignees: [] })).toEqual([]);
  });

  it("tells whether a person is on it", () => {
    const deal = { assignee_id: "a", assignees: [row("a", "1"), row("b", "2")] };
    expect(isOnDeal(deal, "b")).toBe(true);
    expect(isOnDeal(deal, "z")).toBe(false);
  });
});

describe("canSaveAssignees", () => {
  it("never saves an empty list", () => {
    expect(canSaveAssignees([], { me: "a", viewAll: true })).toBe(false);
  });

  it("keeps a worker with only own deals on the deal", () => {
    expect(canSaveAssignees(["b"], { me: "a", viewAll: false })).toBe(false);
    expect(canSaveAssignees(["a", "b"], { me: "a", viewAll: false })).toBe(true);
    expect(canSaveAssignees(["b"], { me: "a", viewAll: true })).toBe(true);
  });

  it("stops at twenty people", () => {
    const many = Array.from({ length: 21 }, (_, i) => `p${i}`);
    expect(canSaveAssignees(many, { me: "p0", viewAll: true })).toBe(false);
  });
});

describe("assigneeChange and nextAssignees", () => {
  it("says who came and who left", () => {
    expect(assigneeChange(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
  });

  it("keeps the place of those staying and puts new people last", () => {
    expect(
      nextAssignees([row("a", "1"), row("b", "2")], ["c", "b"], "3").map((r) => r.assignee_id),
    ).toEqual(["b", "c"]);
  });
});
