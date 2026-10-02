import type { GameMode } from "@/features/game/types";

/** Every step there is; which ones show depends on the chosen mode. */
export type OnboardingStep =
  "welcome" | "mode" | "industry" | "path" | "region" | "milestone" | "contact";

/**
 * The steps shown as dots, in order. Playing the game picks a path (its
 * milestones replace the hand-made first milestone); just using the app
 * starts with one milestone of its own. Before a choice the game is assumed.
 */
export function onboardingSteps(mode: GameMode | null): OnboardingStep[] {
  return mode === "tool"
    ? ["welcome", "mode", "industry", "region", "milestone", "contact"]
    : ["welcome", "mode", "industry", "path", "region", "contact"];
}
