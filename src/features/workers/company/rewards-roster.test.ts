import { describe, expect, it } from "vitest";
import type { Worker } from "../types";
import { formerCount, rewardsRoster } from "./rewards-roster";

const worker = (id: string, status: Worker["status"], userId: string | null): Worker => ({
  id,
  name: id,
  email: null,
  job_title: null,
  status,
  user_id: userId,
  created_at: "2026-11-01T00:00:00Z",
});

const workers = [
  worker("active", "active", "u1"),
  worker("invited", "invited", null),
  worker("left", "inactive", "u2"),
  worker("declined", "inactive", null),
];
const activeIds = new Set(["active"]);

describe("rewardsRoster", () => {
  it("lists only the people of the company now", () => {
    expect(rewardsRoster(workers, activeIds, false)).toEqual([{ worker: workers[0], former: false }]);
  });

  it("adds those who left, marked, but never an invite nobody accepted", () => {
    expect(rewardsRoster(workers, activeIds, true)).toEqual([
      { worker: workers[0], former: false },
      { worker: workers[2], former: true },
    ]);
    expect(formerCount(workers, activeIds)).toBe(1);
  });

  it("trusts the membership, not the record: an 'active' record outside it is not listed", () => {
    expect(rewardsRoster(workers, new Set(), false)).toEqual([]);
  });
});
