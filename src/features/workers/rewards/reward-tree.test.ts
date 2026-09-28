import { describe, expect, it } from "vitest";
import {
  addBranch,
  addLeaf,
  cleanConditions,
  compileRewardTree,
  kindsFor,
  notesWithoutAi,
  parseTree,
  removeLeaf,
  ROOT_ID,
  storedRule,
  toMapBranch,
  updateBranch,
  type RewardTree,
} from "./reward-tree";

const WORKER = "8a3c7c43-9b0e-4d2a-9d3e-4f7b1c2d3e4f";

const tree: RewardTree = {
  branches: [
    {
      id: "b1",
      trigger: "task_completed",
      workerId: null,
      leaves: [{ id: "l1", kind: "fixed", amount: 200, note: "Jen když to stihne do termínu" }],
    },
    {
      id: "b2",
      trigger: "deal_won",
      workerId: WORKER,
      leaves: [
        { id: "l2", kind: "percent", amount: 10, note: "Obchody nad 10 000, max 5 za měsíc" },
        { id: "l3", kind: "fixed", amount: 1000, note: "" },
      ],
    },
    { id: "b3", trigger: "hour_worked", workerId: null, leaves: [{ id: "l4", kind: "hourly", amount: 250, note: "" }] },
  ],
};

describe("reward tree", () => {
  it("offers each trigger only the kinds it can pay", () => {
    expect(kindsFor("hour_worked")).toEqual(["hourly"]);
    expect(kindsFor("deal_won")).toEqual(["fixed", "percent"]);
    expect(kindsFor("meeting_booked")).toEqual(["fixed"]);
  });

  it("maps root, triggers and rules for the shared tree map", () => {
    const map = toMapBranch(tree);
    expect(map.id).toBe(ROOT_ID);
    expect(map.children.map((branch) => branch.children.length)).toEqual([1, 2, 1]);
  });

  it("moves rules to a payable kind when the trigger changes", () => {
    const changed = updateBranch(tree, "b2", { trigger: "hour_worked", workerId: null });
    expect(changed.branches[1].leaves.map((leaf) => leaf.kind)).toEqual(["hourly", "hourly"]);
    const back = updateBranch(tree, "b3", { trigger: "deal_won", workerId: null });
    expect(back.branches[2].leaves[0].kind).toBe("fixed");
  });

  it("adds and removes rules without touching other branches", () => {
    const more = addLeaf(tree, "b1", { id: "l9", kind: "fixed", amount: 1, note: "" });
    expect(more.branches[0].leaves).toHaveLength(2);
    expect(removeLeaf(more, "l9")).toEqual(tree);
    expect(addBranch(tree, { id: "b9", trigger: "meeting_booked", workerId: null, leaves: [] }).branches).toHaveLength(4);
  });

  it("starts over from a stored draft that no longer parses", () => {
    expect(parseTree({ branches: [{ id: "x", trigger: "nope", leaves: [] }] })).toEqual({ branches: [] });
    expect(parseTree(tree)).toEqual(tree);
    // A share above 100 % or an hourly rate on tasks is not a valid tree.
    expect(
      parseTree({
        branches: [{ id: "b", trigger: "task_completed", workerId: null, leaves: [{ id: "l", kind: "hourly", amount: 1, note: "" }] }],
      }),
    ).toEqual({ branches: [] });
  });
});

describe("compiling", () => {
  it("takes kinds and amounts from the tree and only names and conditions from Jarvis", () => {
    const proposal = compileRewardTree(tree, {
      summary: "Za každý úkol 200 Kč.",
      rules: [
        { leafId: "l1", name: "Úkol včas", conditions: { onlyBeforeDue: true, maxPerMonth: 3 } },
        {
          leafId: "l2",
          name: "Podíl z obchodu",
          // Invented keys and amounts from the model never pass.
          conditions: { minDealValue: 10000, maxPerMonth: 5, amount: 99, onlyBeforeDue: true },
        },
        { leafId: "unknown", name: "Made up", conditions: { maxPerMonth: 1 } },
        { leafId: "l4", ignored: "Víkendový příplatek neumím nastavit." },
      ],
    });
    expect(proposal.summary).toBe("Za každý úkol 200 Kč.");
    expect(proposal.ignored).toEqual(["Víkendový příplatek neumím nastavit."]);
    expect(proposal.rules).toEqual([
      {
        name: "Úkol včas",
        workerId: null,
        rule: { trigger: "task_completed", kind: "fixed", amount: 200, conditions: { onlyBeforeDue: true, maxPerMonth: 3 } },
      },
      {
        name: "Podíl z obchodu",
        workerId: WORKER,
        rule: { trigger: "deal_won", kind: "percent", amount: 10, conditions: { minDealValue: 10000, maxPerMonth: 5 } },
      },
      {
        name: "deal_won fixed",
        workerId: WORKER,
        rule: { trigger: "deal_won", kind: "fixed", amount: 1000, conditions: {} },
      },
      {
        name: "hour_worked hourly",
        workerId: null,
        rule: { trigger: "hour_worked", kind: "hourly", amount: 250, conditions: {} },
      },
    ]);
  });

  it("works without Jarvis, naming rules by their notes and applying no conditions", () => {
    const proposal = compileRewardTree(tree, null);
    expect(proposal.summary).toBeNull();
    expect(proposal.rules[0].name).toBe("Jen když to stihne do termínu");
    expect(proposal.rules.every((rule) => Object.keys(rule.rule.conditions).length === 0)).toBe(true);
    expect(notesWithoutAi(tree)).toEqual(["Jen když to stihne do termínu", "Obchody nad 10 000, max 5 za měsíc"]);
  });

  it("keeps only conditions the trigger supports", () => {
    expect(cleanConditions("meeting_booked", { minDealValue: 5, onlyBeforeDue: true, maxPerMonth: 2 })).toEqual({
      maxPerMonth: 2,
    });
    expect(cleanConditions("deal_won", { minDealValue: -1, maxPerMonth: 1.5 })).toEqual({});
    expect(cleanConditions("task_completed", "not an object")).toEqual({});
  });

  it("reads stored rules back and skips rows of another shape", () => {
    expect(
      storedRule({ name: "A", worker_id: null, rules: { trigger: "meeting_booked", kind: "fixed", amount: 150 } }),
    ).toEqual({
      name: "A",
      workerId: null,
      rule: { trigger: "meeting_booked", kind: "fixed", amount: 150, conditions: {} },
    });
    expect(storedRule({ name: "B", worker_id: null, rules: {} })).toBeNull();
  });
});
