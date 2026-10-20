import { describe, expect, it, vi } from "vitest";
import type { PreparedBugReport } from "../report";
import { submitBugReport, type SubmitOutcome } from "./submit-bug-report";

function deps(outcome: SubmitOutcome, userId: string | null = "user-1") {
  const stored: { report: PreparedBugReport; userId: string | null }[] = [];
  const record = vi.fn(async () => undefined);
  return {
    stored,
    record,
    deps: {
      userId,
      store: async (report: PreparedBugReport, sender: string | null) => {
        stored.push({ report, userId: sender });
        return outcome;
      },
      record,
    },
  };
}

const body = { code: "GR-7K3M9Q", page: "/app/milniky", description: "It broke" };

describe("submitBugReport", () => {
  it("stores a report under the session's user and records it once", async () => {
    const { deps: d, stored, record } = deps("created");
    expect(await submitBugReport(body, d)).toEqual({ status: 200, body: { ok: true } });
    expect(stored).toEqual([
      {
        userId: "user-1",
        report: expect.objectContaining({ code: "GR-7K3M9Q", description: "It broke" }),
      },
    ]);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("answers a repeated code like the first, without recording it again", async () => {
    const { deps: d, record } = deps("duplicate");
    expect(await submitBugReport(body, d)).toEqual({ status: 200, body: { ok: true } });
    expect(record).not.toHaveBeenCalled();
  });

  it("works signed out", async () => {
    const { deps: d, stored } = deps("created", null);
    expect((await submitBugReport({ code: "GR-AAAAA2", page: "/" }, d)).status).toBe(200);
    expect(stored[0]?.userId).toBeNull();
  });

  it("says when the limit is reached", async () => {
    const { deps: d, record } = deps("limited");
    expect(await submitBugReport(body, d)).toEqual({ status: 429, body: { error: "limited" } });
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses a malformed body before touching the database", async () => {
    const { deps: d, stored } = deps("created");
    expect((await submitBugReport({ ...body, userId: "other" }, d)).status).toBe(400);
    expect((await submitBugReport(null, d)).status).toBe(400);
    expect(stored).toEqual([]);
  });
});
