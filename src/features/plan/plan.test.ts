import { describe, expect, it } from "vitest";
import { toPlanSnapshot, trialNotice, UNKNOWN_PLAN, type PlanSnapshot } from "./plan";

const now = new Date("2026-10-06T10:00:00Z");
const day = 86_400_000;

function trial(endsInMs: number): PlanSnapshot {
  return {
    planKey: "pro",
    status: "trialing",
    trialEndsAt: new Date(now.getTime() + endsInMs).toISOString(),
    readOnly: false,
  };
}

describe("trialNotice", () => {
  it("shows a quiet bar with the days left", () => {
    expect(trialNotice(trial(9 * day), now)).toEqual({ kind: "trial", daysLeft: 9, urgent: false });
    expect(trialNotice(trial(13.5 * day), now)).toEqual({
      kind: "trial",
      daysLeft: 14,
      urgent: false,
    });
  });

  it("gets louder in the last three days", () => {
    expect(trialNotice(trial(3 * day), now)).toMatchObject({ daysLeft: 3, urgent: true });
    expect(trialNotice(trial(2 * 3_600_000), now)).toMatchObject({ daysLeft: 1, urgent: true });
  });

  it("turns into the plan card once the trial is over", () => {
    expect(trialNotice(trial(-1), now)).toEqual({ kind: "expired" });
    expect(
      trialNotice({ ...trial(-day), status: "expired", readOnly: true }, now),
    ).toEqual({ kind: "expired" });
  });

  it("shows nothing for beta and paid plans", () => {
    expect(trialNotice(UNKNOWN_PLAN, now)).toEqual({ kind: "none" });
    expect(trialNotice({ ...trial(day), status: "active" }, now)).toEqual({ kind: "none" });
  });
});

describe("toPlanSnapshot", () => {
  it("reads current_plan() and never locks out when it is missing", () => {
    expect(
      toPlanSnapshot({
        plan_key: "pro",
        status: "expired",
        trial_ends_at: "2026-10-01T00:00:00Z",
        read_only: true,
      }),
    ).toEqual({
      planKey: "pro",
      status: "expired",
      trialEndsAt: "2026-10-01T00:00:00Z",
      readOnly: true,
    });
    expect(toPlanSnapshot(null)).toEqual(UNKNOWN_PLAN);
  });
});
