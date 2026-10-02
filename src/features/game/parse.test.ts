import { describe, expect, it } from "vitest";
import { parseAwardResult, parseGameState } from "./parse";
import { localized } from "./types";

describe("parseAwardResult", () => {
  it("reads award_xp() output, including a level-up with what it unlocked", () => {
    const result = parseAwardResult({
      awarded: true,
      xp: 10,
      reason: "task_completed",
      total_xp: "700",
      previous_level: 2,
      level: 3,
      leveled_up: true,
      unlocks: [
        {
          key: "theme_aurora",
          kind: "theme",
          name: { en: "Aurora theme", cs: "Téma Polární záře" },
          description: { en: "d", cs: "p" },
          icon: "palette",
          source: "level",
          level: 3,
        },
      ],
      achievements: [{ key: "first_task", name: { en: "First Step", cs: "První krok" } }],
      streak: 4,
    });
    expect(result.totalXp).toBe(700);
    expect(result.leveledUp).toBe(true);
    expect(result.unlocks[0]).toMatchObject({ key: "theme_aurora", source: "level", level: 3 });
    expect(localized(result.achievements[0]!.name, "cs")).toBe("První krok");
  });

  it("falls back to a quiet no-award on anything unexpected", () => {
    const result = parseAwardResult(null);
    expect(result.awarded).toBe(false);
    expect(result.level).toBe(1);
    expect(result.unlocks).toEqual([]);
  });
});

describe("parseGameState", () => {
  it("reads sections with the milestone that opens them", () => {
    const state = parseGameState({
      mode: "game",
      path_key: "craftsman",
      total_xp: 120,
      level: 1,
      level_xp: 0,
      next_level_xp: 364,
      streak: 2,
      streak_freeze_available: false,
      unlocked: ["section_contacts"],
      sections: [
        {
          key: "section_cold_calling",
          unlocked: false,
          unlocked_at: null,
          seen_at: null,
          level: null,
          milestone: { id: "m1", title: "Get on the map", completed: false },
          template_title: { en: "Get on the map", cs: "Dostaň se na mapu" },
        },
      ],
    });
    expect(state.mode).toBe("game");
    expect(state.nextLevelXp).toBe(364);
    expect(state.streakFreezeAvailable).toBe(false);
    expect(state.sections[0]!.milestone?.title).toBe("Get on the map");
    expect(localized(state.sections[0]!.templateTitle, "cs")).toBe("Dostaň se na mapu");
  });

  it("treats only an explicit tool mode as tool", () => {
    expect(parseGameState({ mode: "tool" }).mode).toBe("tool");
    expect(parseGameState({}).mode).toBe("game");
    expect(parseGameState({ level: 30, next_level_xp: null }).nextLevelXp).toBeNull();
  });
});
