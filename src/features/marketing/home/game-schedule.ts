/**
 * The milestone demo on the website, played once when it scrolls into view:
 * the last task is ticked, the complete button unlocks, it is pressed (in the
 * app the user always completes a milestone by hand) and the small celebration
 * runs. Times in ms from the start.
 */
export const GAME_STAGES = [
  "waiting",
  "ticked",
  "unlocked",
  "pressed",
  "celebrating",
  "done",
] as const;
export type GameStage = (typeof GAME_STAGES)[number];

export const GAME_SCHEDULE: Record<Exclude<GameStage, "waiting">, number> = {
  ticked: 700,
  unlocked: 1300,
  pressed: 2300,
  celebrating: 2550,
  done: 4600,
};

export function gameStageAt(elapsed: number): GameStage {
  let stage: GameStage = "waiting";
  for (const name of GAME_STAGES.slice(1) as Exclude<GameStage, "waiting">[]) {
    if (elapsed >= GAME_SCHEDULE[name]) stage = name;
  }
  return stage;
}

export function stageReached(stage: GameStage, target: GameStage): boolean {
  return GAME_STAGES.indexOf(stage) >= GAME_STAGES.indexOf(target);
}
