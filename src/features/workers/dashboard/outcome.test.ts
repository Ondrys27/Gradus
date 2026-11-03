import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";
import { outcomeDay, taskOutcome, type WorkTask } from "./outcome";

const prague = { ...DEFAULT_FORMAT_SETTINGS, timeZone: "Europe/Prague" };

function crm(partial: Partial<WorkTask>): WorkTask {
  return {
    id: "t",
    origin: "crm",
    title: "Call",
    done: false,
    dueAt: "2026-11-03T14:00:00.000Z", // 15:00 in Prague
    dueDay: null,
    completedAt: null,
    createdAt: "2026-11-01T08:00:00.000Z",
    ...partial,
  };
}
function owner(partial: Partial<WorkTask>): WorkTask {
  return crm({ origin: "owner", dueAt: null, dueDay: "2026-11-03", ...partial });
}

describe("sales task outcome", () => {
  it("is in time when done within the due minute", () => {
    expect(
      taskOutcome(crm({ done: true, completedAt: "2026-11-03T14:00:40.000Z" }), new Date(), prague),
    ).toBe("onTime");
    expect(
      taskOutcome(crm({ done: true, completedAt: "2026-11-03T13:00:00.000Z" }), new Date(), prague),
    ).toBe("onTime");
  });

  it("is late when done after the due minute", () => {
    expect(
      taskOutcome(crm({ done: true, completedAt: "2026-11-03T14:01:00.000Z" }), new Date(), prague),
    ).toBe("late");
  });

  it("is missed once an open task is past due, open before", () => {
    expect(taskOutcome(crm({}), new Date("2026-11-03T13:59:00.000Z"), prague)).toBe("open");
    expect(taskOutcome(crm({}), new Date("2026-11-03T14:01:00.000Z"), prague)).toBe("missed");
  });
});

describe("task from the owner outcome", () => {
  it("counts the due day until its end in the user's zone", () => {
    // 23:30 on the 3rd in Prague is 22:30 UTC: still in time.
    expect(
      taskOutcome(
        owner({ done: true, completedAt: "2026-11-03T22:30:00.000Z" }),
        new Date(),
        prague,
      ),
    ).toBe("onTime");
    // 00:30 on the 4th in Prague is 23:30 UTC on the 3rd: late, though UTC says the 3rd.
    expect(
      taskOutcome(
        owner({ done: true, completedAt: "2026-11-03T23:30:00.000Z" }),
        new Date(),
        prague,
      ),
    ).toBe("late");
  });

  it("is overdue only from the next day", () => {
    expect(taskOutcome(owner({}), new Date("2026-11-03T22:00:00.000Z"), prague)).toBe("open");
    expect(taskOutcome(owner({}), new Date("2026-11-03T23:10:00.000Z"), prague)).toBe("missed");
  });

  it("without a due date is in time when done and open when not", () => {
    expect(
      taskOutcome(
        owner({ dueDay: null, done: true, completedAt: "2026-11-09T10:00:00.000Z" }),
        new Date(),
        prague,
      ),
    ).toBe("onTime");
    expect(taskOutcome(owner({ dueDay: null }), new Date("2030-01-01T00:00:00.000Z"), prague)).toBe(
      "open",
    );
  });
});

describe("outcome day", () => {
  it("is the completion day for done tasks and the due day for missed ones, in the zone", () => {
    const late = crm({ done: true, completedAt: "2026-11-03T23:30:00.000Z" });
    expect(outcomeDay(late, "late", prague)).toBe("2026-11-04");
    expect(outcomeDay(crm({ dueAt: "2026-11-03T23:30:00.000Z" }), "missed", prague)).toBe(
      "2026-11-04",
    );
    expect(outcomeDay(owner({}), "missed", prague)).toBe("2026-11-03");
    expect(outcomeDay(crm({}), "open", prague)).toBeNull();
  });
});
