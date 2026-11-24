import { z } from "zod";
import { definitionErrors, normalizeDefinition, type RuleDefinition } from "./definition";

/**
 * "Describe how you reward" (29.1): what Grady proposes and how the owner's
 * answers to his questions fill it in. Shared by the route
 * (src/features/grady/server/reward-setup.ts) and the plan.
 */

export const REWARD_SETUP_REQUEST_MAX = 1000;

export const rewardSetupRequestSchema = z.object({
  kind: z.literal("rewardSetup"),
  workerId: z.uuid(),
  request: z.string().trim().min(1).max(REWARD_SETUP_REQUEST_MAX),
});

/** A table or stage the owner has to pick: which side of the move it fills, which question. */
export type SetupAsk = { side: "from" | "to"; question: string };

export type RewardSetupChange =
  | { op: "add"; definition: RuleDefinition; asks: SetupAsk[]; why: string | null }
  | { op: "update"; ruleId: string; definition: RuleDefinition; asks: SetupAsk[]; why: string | null }
  | { op: "remove"; ruleId: string; why: string | null };

export type RewardSetupQuestion = {
  key: string;
  text: string;
  options: Array<{ id: string; label: string }>;
};

export type RewardSetupProposal = {
  changes: RewardSetupChange[];
  unsupported: Array<{ text: string; nearest: string | null }>;
  questions: RewardSetupQuestion[];
};

/** The rule with the owner's picks put where Grady asked; still asking = not ready. */
export function answeredDefinition(
  change: Extract<RewardSetupChange, { definition: RuleDefinition }>,
  answers: Readonly<Record<string, readonly string[]>>,
): RuleDefinition | null {
  const event = { ...change.definition.event };
  for (const ask of change.asks) {
    const picked = answers[ask.question] ?? [];
    if (!picked.length) return null;
    const side = event[ask.side] ?? { mode: "only" as const, ids: [] };
    event[ask.side] = {
      mode: side.mode === "any" ? "only" : side.mode,
      ids: [...new Set([...side.ids, ...picked])],
    } as never;
  }
  const definition = normalizeDefinition({ ...change.definition, event });
  return definitionErrors(definition).length ? null : definition;
}
