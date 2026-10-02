import { describe, expect, it } from "vitest";
import {
  countOpenTasks,
  remainingToday,
  todaySources,
  xpSuggestions,
  type FocusMilestone,
} from "./overview";
import type { LockableSection } from "./types";

const allOpen = () => true;
const focus = (patch: Partial<FocusMilestone> = {}): FocusMilestone => ({
  id: "m1",
  title: "Price list",
  openTasks: 2,
  openSubtasks: 0,
  totalTasks: 4,
  xp: 250,
  paysXp: true,
  ...patch,
});

describe("todaySources", () => {
  it("sums today's events per source against the caps", () => {
    const sources = todaySources(
      [
        { kind: "contact_moved", xp: 5 },
        { kind: "contact_moved", xp: 5 },
        { kind: "task_completed", xp: 10 },
        { kind: "milestone_completed", xp: 250 },
        { kind: "onboarding_completed", xp: 50 },
      ],
      { streak: 2 },
    );
    const by = Object.fromEntries(sources.map((s) => [s.key, s]));
    expect(by.contact_moved).toMatchObject({ earned: 10, cap: 50, section: "contacts" });
    expect(by.task_completed).toMatchObject({ earned: 10, cap: 200, section: null });
    expect(by.milestone_completed).toMatchObject({ earned: 250, cap: null });
    expect(by.daily_login).toMatchObject({ earned: 0, cap: 20 });
    expect(by.call_30min).toMatchObject({ cap: 30, section: "coldCalling" });
    expect(sources).toHaveLength(10);
  });

  it("caps the login bonus at three times", () => {
    const login = todaySources([], { streak: 12 }).find((s) => s.key === "daily_login");
    expect(login?.cap).toBe(30);
  });
});

describe("remainingToday", () => {
  it("is never negative and unlimited without a cap", () => {
    expect(remainingToday({ key: "contact_moved", earned: 60, cap: 50, section: null })).toBe(0);
    expect(
      remainingToday({ key: "milestone_completed", earned: 9, cap: null, section: null }),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(remainingToday(undefined)).toBe(0);
  });
});

describe("xpSuggestions", () => {
  it("starts with the open tasks of the focus milestone", () => {
    const list = xpSuggestions({
      focus: focus({ openTasks: 1, openSubtasks: 2 }),
      sources: todaySources([], { streak: 1 }),
      isOpen: allOpen,
    });
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({
      kind: "finishTasks",
      milestoneId: "m1",
      milestone: "Price list",
      count: 3,
      xp: 20,
    });
    expect(list.map((s) => s.kind)).toEqual(["finishTasks", "callToday", "moveContacts"]);
  });

  it("points to completing a milestone whose tasks are all done", () => {
    const [first] = xpSuggestions({
      focus: focus({ openTasks: 0, openSubtasks: 0 }),
      sources: todaySources([], { streak: 1 }),
      isOpen: allOpen,
    });
    expect(first).toEqual({
      kind: "completeMilestone",
      milestoneId: "m1",
      milestone: "Price list",
      xp: 250,
    });
  });

  it("does not promise XP a milestone already paid", () => {
    const list = xpSuggestions({
      focus: focus({ openTasks: 0, paysXp: false }),
      sources: todaySources([], { streak: 1 }),
      isOpen: allOpen,
    });
    expect(list.some((s) => s.kind === "completeMilestone")).toBe(false);
  });

  it("asks for a first task on an empty milestone", () => {
    const [first] = xpSuggestions({
      focus: focus({ totalTasks: 0, openTasks: 0 }),
      sources: todaySources([], { streak: 1 }),
      isOpen: allOpen,
    });
    expect(first?.kind).toBe("firstTask");
  });

  it("skips locked sections and sources capped out today", () => {
    const locked = new Set<LockableSection>(["coldCalling", "calendar"]);
    const list = xpSuggestions({
      focus: null,
      sources: todaySources(
        Array.from({ length: 10 }, () => ({ kind: "contact_moved", xp: 5 })),
        { streak: 1 },
      ),
      isOpen: (section) => !locked.has(section),
    });
    expect(list.map((s) => s.kind)).toEqual(["bookMeeting", "addTransaction"]);
  });

  it("suggests only as many moves as the cap still pays, and trims task XP to the cap", () => {
    const sources = todaySources(
      [
        ...Array.from({ length: 8 }, () => ({ kind: "contact_moved", xp: 5 })),
        { kind: "task_completed", xp: 195 },
      ],
      { streak: 1 },
    );
    const list = xpSuggestions({ focus: focus({ openTasks: 3 }), sources, isOpen: allOpen });
    expect(list.find((s) => s.kind === "finishTasks")).toMatchObject({ count: 3, xp: 5 });
    expect(list.find((s) => s.kind === "moveContacts")).toEqual({
      kind: "moveContacts",
      count: 2,
      xp: 10,
    });
  });
});

describe("countOpenTasks", () => {
  it("counts open tasks and subtasks apart", () => {
    expect(
      countOpenTasks([
        { parent_task_id: null, status: "done" },
        { parent_task_id: null, status: "todo" },
        { parent_task_id: "a", status: "in_progress" },
        { parent_task_id: "a", status: "done" },
      ]),
    ).toEqual({ openTasks: 1, openSubtasks: 1, totalTasks: 4 });
  });
});
