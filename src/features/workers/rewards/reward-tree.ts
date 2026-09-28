import { z } from "zod";
import type { MapBranch } from "@/components/tree-map/tree-map-layout";

/**
 * The reward system as the owner draws it: a root, triggers as branches, rules
 * as leaves. Each rule has a kind and an amount the owner typed, plus a note in
 * plain words for conditions. Jarvis only turns the notes into the supported
 * conditions and explains the result; kinds and amounts never come from the model.
 */

export const REWARD_TRIGGERS = ["task_completed", "meeting_booked", "deal_won", "hour_worked"] as const;
export type RewardTrigger = (typeof REWARD_TRIGGERS)[number];

export const REWARD_KINDS = ["fixed", "percent", "hourly"] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

export const ROOT_ID = "rewards-root";
export const MAX_BRANCHES = 20;
export const MAX_LEAVES = 20;
export const NOTE_MAX = 300;
export const AMOUNT_MAX = 10_000_000;
export const PERCENT_MAX = 100;
export const RULE_NAME_MAX = 120;
export const SUMMARY_MAX = 2000;

/** What a trigger can pay: hours by the hour, deals fixed or as a share, the rest fixed. */
export function kindsFor(trigger: RewardTrigger): RewardKind[] {
  switch (trigger) {
    case "hour_worked":
      return ["hourly"];
    case "deal_won":
      return ["fixed", "percent"];
    default:
      return ["fixed"];
  }
}

const leafSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(REWARD_KINDS),
  amount: z.number().positive().max(AMOUNT_MAX),
  note: z.string().max(NOTE_MAX),
});

const branchSchema = z.object({
  id: z.string().min(1).max(64),
  trigger: z.enum(REWARD_TRIGGERS),
  workerId: z.uuid().nullable(),
  leaves: z.array(leafSchema).max(MAX_LEAVES),
});

export const rewardTreeSchema = z
  .object({ branches: z.array(branchSchema).max(MAX_BRANCHES) })
  .superRefine((tree, context) => {
    tree.branches.forEach((branch, b) =>
      branch.leaves.forEach((leaf, l) => {
        if (!kindsFor(branch.trigger).includes(leaf.kind)) {
          context.addIssue({ code: "custom", path: ["branches", b, "leaves", l, "kind"], message: "kind" });
        }
        if (leaf.kind === "percent" && leaf.amount > PERCENT_MAX) {
          context.addIssue({ code: "custom", path: ["branches", b, "leaves", l, "amount"], message: "amount" });
        }
      }),
    );
  });

export type RewardLeaf = z.infer<typeof leafSchema>;
export type RewardBranch = z.infer<typeof branchSchema>;
export type RewardTree = z.infer<typeof rewardTreeSchema>;

export const EMPTY_TREE: RewardTree = { branches: [] };

/** A stored draft that no longer parses starts over rather than breaking the editor. */
export function parseTree(value: unknown): RewardTree {
  const parsed = rewardTreeSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_TREE;
}

/** The tree for the shared map component: root, triggers, rules. */
export function toMapBranch(tree: RewardTree): MapBranch {
  return {
    id: ROOT_ID,
    children: tree.branches.map((branch) => ({
      id: branch.id,
      children: branch.leaves.map((leaf) => ({ id: leaf.id, children: [] })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export function addBranch(tree: RewardTree, branch: RewardBranch): RewardTree {
  return { branches: [...tree.branches, branch] };
}

/**
 * Changing a trigger keeps the rules and moves each to a kind the new trigger
 * can pay; a share above 100 % becomes a fixed amount.
 */
export function updateBranch(
  tree: RewardTree,
  id: string,
  patch: Pick<RewardBranch, "trigger" | "workerId">,
): RewardTree {
  return {
    branches: tree.branches.map((branch) => {
      if (branch.id !== id) return branch;
      const allowed = kindsFor(patch.trigger);
      return {
        ...branch,
        ...patch,
        leaves: branch.leaves.map((leaf) => {
          const kind = allowed.includes(leaf.kind) ? leaf.kind : allowed[0];
          const amount = kind === "percent" ? Math.min(leaf.amount, PERCENT_MAX) : leaf.amount;
          return { ...leaf, kind, amount };
        }),
      };
    }),
  };
}

export function removeBranch(tree: RewardTree, id: string): RewardTree {
  return { branches: tree.branches.filter((branch) => branch.id !== id) };
}

export function addLeaf(tree: RewardTree, branchId: string, leaf: RewardLeaf): RewardTree {
  return {
    branches: tree.branches.map((branch) =>
      branch.id === branchId ? { ...branch, leaves: [...branch.leaves, leaf] } : branch,
    ),
  };
}

export function updateLeaf(tree: RewardTree, leaf: RewardLeaf): RewardTree {
  return {
    branches: tree.branches.map((branch) => ({
      ...branch,
      leaves: branch.leaves.map((item) => (item.id === leaf.id ? leaf : item)),
    })),
  };
}

export function removeLeaf(tree: RewardTree, leafId: string): RewardTree {
  return {
    branches: tree.branches.map((branch) => ({
      ...branch,
      leaves: branch.leaves.filter((leaf) => leaf.id !== leafId),
    })),
  };
}

export function findLeaf(
  tree: RewardTree,
  leafId: string,
): { branch: RewardBranch; leaf: RewardLeaf } | null {
  for (const branch of tree.branches) {
    const leaf = branch.leaves.find((item) => item.id === leafId);
    if (leaf) return { branch, leaf };
  }
  return null;
}

export function leafCount(tree: RewardTree): number {
  return tree.branches.reduce((sum, branch) => sum + branch.leaves.length, 0);
}

// ---------------------------------------------------------------------------
// Compiling into reward_rules
// ---------------------------------------------------------------------------

export const conditionsSchema = z
  .object({
    minDealValue: z.number().min(0).max(AMOUNT_MAX * 100).optional(),
    onlyBeforeDue: z.boolean().optional(),
    maxPerMonth: z.number().int().min(1).max(999_999).optional(),
  })
  .strict();
export type RewardConditions = z.infer<typeof conditionsSchema>;

/** The rule stored in reward_rules.rules; the database checks the same shape. */
export const compiledRuleSchema = z.object({
  name: z.string().trim().min(1).max(RULE_NAME_MAX),
  workerId: z.uuid().nullable(),
  rule: z.object({
    trigger: z.enum(REWARD_TRIGGERS),
    kind: z.enum(REWARD_KINDS),
    amount: z.number().positive().max(AMOUNT_MAX),
    conditions: conditionsSchema,
  }),
});
export type CompiledRule = z.infer<typeof compiledRuleSchema>;

/** Jarvis's answer: per rule a name and conditions read from the note, plus a summary. */
export const setupAnswerSchema = z.object({
  summary: z.string().trim().min(1).max(SUMMARY_MAX),
  rules: z
    .array(
      z.object({
        leafId: z.string().max(64),
        name: z.string().trim().max(RULE_NAME_MAX).optional(),
        conditions: z.record(z.string(), z.unknown()).optional(),
        ignored: z.string().trim().max(NOTE_MAX).optional(),
      }),
    )
    .max(MAX_BRANCHES * MAX_LEAVES),
});
export type SetupAnswer = z.infer<typeof setupAnswerSchema>;

export type RewardProposal = {
  rules: CompiledRule[];
  /** Jarvis's explanation; null when the rules were set up without it. */
  summary: string | null;
  /** Parts of notes no supported condition could express. */
  ignored: string[];
};

/**
 * Keeps only conditions the trigger supports, with valid values. Anything the
 * model made up beyond that is dropped here, before the database sees it.
 */
export function cleanConditions(trigger: RewardTrigger, raw: unknown): RewardConditions {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const out: RewardConditions = {};
  const min = source.minDealValue;
  if (trigger === "deal_won" && typeof min === "number" && Number.isFinite(min) && min > 0) {
    out.minDealValue = Math.min(Math.round(min * 100) / 100, AMOUNT_MAX * 100);
  }
  if (trigger === "task_completed" && source.onlyBeforeDue === true) {
    out.onlyBeforeDue = true;
  }
  const max = source.maxPerMonth;
  if (typeof max === "number" && Number.isInteger(max) && max >= 1 && max <= 999_999) {
    out.maxPerMonth = max;
  }
  return out;
}

/** A rule's fallback name: its note, or its trigger and kind. */
function defaultName(branch: RewardBranch, leaf: RewardLeaf): string {
  const note = leaf.note.replace(/\s+/g, " ").trim();
  return (note || `${branch.trigger} ${leaf.kind}`).slice(0, RULE_NAME_MAX);
}

/**
 * One reward_rules row per leaf. Trigger, worker, kind and amount come from the
 * tree; names and conditions from Jarvis's answer when there is one.
 */
export function compileRewardTree(tree: RewardTree, answer: SetupAnswer | null): RewardProposal {
  const byLeaf = new Map(answer?.rules.map((rule) => [rule.leafId, rule]) ?? []);
  const rules: CompiledRule[] = [];
  const ignored: string[] = [];

  for (const branch of tree.branches) {
    for (const leaf of branch.leaves) {
      if (!kindsFor(branch.trigger).includes(leaf.kind)) continue;
      const fromModel = byLeaf.get(leaf.id);
      if (fromModel?.ignored) ignored.push(fromModel.ignored);
      rules.push({
        name: fromModel?.name?.trim() || defaultName(branch, leaf),
        workerId: branch.workerId,
        rule: {
          trigger: branch.trigger,
          kind: leaf.kind,
          amount: leaf.kind === "percent" ? Math.min(leaf.amount, PERCENT_MAX) : leaf.amount,
          conditions: cleanConditions(branch.trigger, fromModel?.conditions),
        },
      });
    }
  }
  return { rules, summary: answer?.summary ?? null, ignored };
}

/** Rules whose note would be lost when saving without Jarvis. */
export function notesWithoutAi(tree: RewardTree): string[] {
  return tree.branches.flatMap((branch) =>
    branch.leaves.map((leaf) => leaf.note.trim()).filter(Boolean),
  );
}

/** Reads a stored reward_rules row back into the compiled shape, or null if it is not one. */
export function storedRule(row: {
  name: string;
  worker_id: string | null;
  rules: unknown;
}): CompiledRule | null {
  const parsed = compiledRuleSchema.safeParse({
    name: row.name,
    workerId: row.worker_id,
    rule: {
      ...(row.rules as object),
      conditions: (row.rules as { conditions?: unknown } | null)?.conditions ?? {},
    },
  });
  return parsed.success ? parsed.data : null;
}
