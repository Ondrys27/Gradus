import { describe, expect, it } from "vitest";
import { buildPathProgress, type TemplateStep } from "./path-progress";

function step(
  id: string,
  key: string,
  chapter: number,
  position: number,
  pathKey = "general",
): TemplateStep {
  return {
    id,
    key,
    pathKey,
    chapter,
    position,
    title: { en: key, cs: key },
    xp: 100,
    unlockKey: null,
  };
}

const templates = [
  step("g2", "offer", 1, 2),
  step("g1", "licence", 1, 1),
  step("g3", "contacts", 2, 1),
  step("g4", "meeting", 2, 2),
  step("c1", "licence", 1, 1, "craftsman"),
];

describe("buildPathProgress", () => {
  it("orders steps by chapter and marks done, current and upcoming", () => {
    const progress = buildPathProgress("general", templates, [
      { id: "m1", templateId: "g1", title: "My licence", completed: true },
      { id: "m2", templateId: "g2", title: "Offer", completed: false },
      { id: "m3", templateId: "g3", title: "Contacts", completed: false },
      { id: "m4", templateId: "g4", title: "Meeting", completed: false },
    ]);
    expect(progress.chapters.map((c) => [c.chapter, c.done, c.total])).toEqual([
      [1, 1, 2],
      [2, 0, 2],
    ]);
    expect(progress.chapters[0]!.steps.map((s) => [s.key, s.state])).toEqual([
      ["licence", "done"],
      ["offer", "current"],
    ]);
    expect(progress.chapters[1]!.steps.map((s) => s.state)).toEqual(["upcoming", "upcoming"]);
    expect(progress.current).toMatchObject({ key: "offer", milestoneId: "m2", ownTitle: "Offer" });
    expect([progress.done, progress.total]).toEqual([1, 4]);
  });

  it("counts a step copied from another path by its key", () => {
    const progress = buildPathProgress("general", templates, [
      { id: "m1", templateId: "c1", title: "Licence", completed: true },
    ]);
    expect(progress.chapters[0]!.steps[0]).toMatchObject({
      key: "licence",
      state: "done",
      milestoneId: "m1",
    });
  });

  it("marks deleted steps as removed and skips them when picking the current one", () => {
    const progress = buildPathProgress("general", templates, [
      { id: "m3", templateId: "g3", title: "Contacts", completed: false },
    ]);
    expect(progress.chapters[0]!.steps.map((s) => s.state)).toEqual(["removed", "removed"]);
    expect(progress.current?.key).toBe("contacts");
  });

  it("is empty without a path", () => {
    expect(buildPathProgress(null, templates, [])).toEqual({
      chapters: [],
      current: null,
      done: 0,
      total: 0,
    });
  });
});
