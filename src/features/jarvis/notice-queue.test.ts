import { describe, expect, it } from "vitest";
import {
  dotWindow,
  orderNotices,
  resolveCurrent,
  stepIndex,
  swipeStep,
  urgencyOf,
} from "./notice-queue";

const notice = (id: string, type: string, createdAt: string, notBefore: string | null = null) => ({
  id,
  type,
  createdAt,
  notBefore,
});

describe("orderNotices", () => {
  it("puts the most urgent first, then the newest", () => {
    const ordered = orderNotices([
      notice("insight", "insight", "2026-10-20T09:00:00Z"),
      notice("won", "dealWon", "2026-10-20T08:00:00Z"),
      notice("overdue-old", "overdueTask", "2026-10-18T08:00:00Z"),
      notice("undo", "taskCompleted", "2026-10-17T08:00:00Z"),
      notice("overdue-new", "overdueTask", "2026-10-19T08:00:00Z"),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      "undo",
      "overdue-new",
      "overdue-old",
      "won",
      "insight",
    ]);
  });

  it("lets a call that has to wait for the time window go after what can be done now", () => {
    const ordered = orderNotices([
      notice("call", "followUps", "2026-10-20T09:00:00Z", "2026-10-21T06:00:00Z"),
      notice("insight", "insight", "2026-10-19T09:00:00Z"),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["insight", "call"]);
  });

  it("puts unknown types last and leaves the input as it was", () => {
    const input = [
      notice("x", "somethingNew", "2026-10-20T09:00:00Z"),
      notice("i", "insight", "2026-10-01T09:00:00Z"),
    ];
    expect(orderNotices(input).map((item) => item.id)).toEqual(["i", "x"]);
    expect(input[0]!.id).toBe("x");
    expect(urgencyOf("somethingNew")).toBeGreaterThan(urgencyOf("insight"));
  });
});

describe("stepIndex", () => {
  it("goes round at both ends", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe("resolveCurrent", () => {
  const abc = ["a", "b", "c"];

  it("keeps the notice on screen while it is queued, also when a new one comes first", () => {
    expect(resolveCurrent(abc, "b", abc)).toBe("b");
    expect(resolveCurrent(abc, "b", ["new", ...abc])).toBe("b");
  });

  it("hands a closed notice's place to the next one", () => {
    expect(resolveCurrent(abc, "a", ["b", "c"])).toBe("b");
    expect(resolveCurrent(abc, "b", ["a", "c"])).toBe("c");
  });

  it("goes round to the start after the last one", () => {
    expect(resolveCurrent(abc, "c", ["a", "b"])).toBe("a");
  });

  it("skips what left together with it and ends when nothing is left", () => {
    expect(resolveCurrent(["a", "b", "c", "d"], "a", ["d"])).toBe("d");
    expect(resolveCurrent(abc, "a", [])).toBeNull();
    expect(resolveCurrent([], null, abc)).toBe("a");
  });

  it("three notices: close one, the second shows; skipping keeps the first in the queue", () => {
    // On screen: a (1 of 3). Close it → b (1 of 2).
    let ids = abc;
    let current = resolveCurrent(ids, "a", ["b", "c"]);
    ids = ["b", "c"];
    expect(current).toBe("b");
    // Skip forward to c, then back: b is still there, it was skipped, not closed.
    current = ids[stepIndex(ids.indexOf(current!), 1, ids.length)]!;
    expect(current).toBe("c");
    current = ids[stepIndex(ids.indexOf(current), -1, ids.length)]!;
    expect(current).toBe("b");
    expect(ids).toContain("b");
  });
});

describe("dotWindow", () => {
  it("draws one dot per notice up to five", () => {
    expect(dotWindow(0, 1)).toEqual({ start: 0, end: 1 });
    expect(dotWindow(3, 5)).toEqual({ start: 0, end: 5 });
  });

  it("slides five dots along a longer queue, the current one always among them", () => {
    expect(dotWindow(0, 9)).toEqual({ start: 0, end: 5 });
    expect(dotWindow(4, 9)).toEqual({ start: 2, end: 7 });
    expect(dotWindow(8, 9)).toEqual({ start: 4, end: 9 });
    for (let index = 0; index < 9; index += 1) {
      const { start, end } = dotWindow(index, 9);
      expect(end - start).toBe(5);
      expect(index >= start && index < end).toBe(true);
    }
  });
});

describe("swipeStep", () => {
  it("shows the next one on a swipe to the left and the previous one to the right", () => {
    expect(swipeStep(-80, 0)).toBe(1);
    expect(swipeStep(80, 0)).toBe(-1);
    expect(swipeStep(-10, -900)).toBe(1);
    expect(swipeStep(20, 100)).toBe(0);
  });
});
