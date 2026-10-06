import { describe, expect, it } from "vitest";
import { GAME_SCHEDULE, GAME_STAGES, gameStageAt, stageReached } from "./game-schedule";

describe("milestone demo schedule", () => {
  it("runs the stages in order", () => {
    const times = GAME_STAGES.slice(1).map(
      (stage) => GAME_SCHEDULE[stage as keyof typeof GAME_SCHEDULE],
    );
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("maps time to the stage", () => {
    expect(gameStageAt(0)).toBe("waiting");
    expect(gameStageAt(GAME_SCHEDULE.ticked)).toBe("ticked");
    expect(gameStageAt(GAME_SCHEDULE.pressed + 1)).toBe("pressed");
    expect(gameStageAt(60_000)).toBe("done");
  });

  it("the milestone is completed only after the button was pressed", () => {
    expect(GAME_SCHEDULE.unlocked).toBeGreaterThan(GAME_SCHEDULE.ticked);
    expect(GAME_SCHEDULE.celebrating).toBeGreaterThan(GAME_SCHEDULE.pressed);
    expect(stageReached("unlocked", "celebrating")).toBe(false);
    expect(stageReached("done", "celebrating")).toBe(true);
  });
});
