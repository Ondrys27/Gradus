// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { RewardTree } from "@/features/workers/rewards/reward-tree";

vi.mock("server-only", () => ({}));

const { runRewardSetup, rewardSetupContext, REWARD_SETUP_INSTRUCTIONS } = await import(
  "./reward-setup"
);
const { JARVIS_MODELS } = await import("../models");

type StreamEvent = Anthropic.MessageStreamEvent;

/** A stand-in for the SDK that streams the given text, or fails like a key without credits. */
function fakeModel(answer: string | Error) {
  const calls: Anthropic.MessageStreamParams[] = [];
  const client = {
    messages: {
      stream: (params: Anthropic.MessageStreamParams) => {
        calls.push(params);
        return (async function* () {
          yield {
            type: "message_start",
            message: { usage: { input_tokens: 10, output_tokens: 1 } },
          } as unknown as StreamEvent;
          if (answer instanceof Error) throw answer;
          yield {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: answer },
          } as StreamEvent;
          yield {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 20 },
          } as unknown as StreamEvent;
        })();
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  return { client, calls };
}

const WORKER = "8a3c7c43-9b0e-4d2a-9d3e-4f7b1c2d3e4f";
const tree: RewardTree = {
  branches: [
    {
      id: "b1",
      trigger: "deal_won",
      workerId: WORKER,
      leaves: [{ id: "l1", kind: "percent", amount: 10, note: "jen obchody nad 20 000" }],
    },
    {
      id: "b2",
      trigger: "meeting_booked",
      workerId: null,
      leaves: [{ id: "l2", kind: "fixed", amount: 150, note: "" }],
    },
  ],
};

describe("reward setup", () => {
  it("gives the model the tree with worker names and keeps the instructions cacheable", () => {
    const context = rewardSetupContext(tree, [{ id: WORKER, name: "Jana" }], "CZK", "cs");
    expect(context).toContain('"worker": "Jana"');
    expect(context).toContain('"worker": "all workers"');
    expect(context).toContain('"leafId": "l1"');
    expect(context).toContain("jen obchody nad 20 000");
    expect(REWARD_SETUP_INSTRUCTIONS).not.toContain("Jana");
  });

  it("compiles Sonnet's answer, never taking amounts from it, and logs the call once", async () => {
    const { client, calls } = fakeModel(
      JSON.stringify({
        summary: "Jana dostane 10 % z obchodů nad 20 000 Kč, všichni 150 Kč za schůzku.",
        rules: [
          { leafId: "l1", name: "Podíl z obchodu", conditions: { minDealValue: 20000, amount: 50 } },
          { leafId: "l2", name: "Schůzka", conditions: {} },
        ],
      }),
    );
    const log = vi.fn(async () => {});
    const result = await runRewardSetup({
      client,
      tree,
      workers: [{ id: WORKER, name: "Jana" }],
      currency: "CZK",
      locale: "cs",
      log,
    });

    expect(calls[0].model).toBe(JARVIS_MODELS.sonnet);
    const system = calls[0].system as { text: string; cache_control?: unknown }[];
    expect(system[0].text).toBe(REWARD_SETUP_INSTRUCTIONS);
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ feature: "reward_setup" }));

    expect(result).toEqual({
      ok: true,
      proposal: {
        summary: "Jana dostane 10 % z obchodů nad 20 000 Kč, všichni 150 Kč za schůzku.",
        ignored: [],
        rules: [
          {
            name: "Podíl z obchodu",
            workerId: WORKER,
            rule: { trigger: "deal_won", kind: "percent", amount: 10, conditions: { minDealValue: 20000 } },
          },
          {
            name: "Schůzka",
            workerId: null,
            rule: { trigger: "meeting_booked", kind: "fixed", amount: 150, conditions: {} },
          },
        ],
      },
    });
  });

  it("reports a failed call clearly and still logs it", async () => {
    const { client } = fakeModel(new Error("credit balance is too low"));
    const log = vi.fn(async () => {});
    const result = await runRewardSetup({ client, tree, workers: [], currency: "CZK", locale: "en", log });
    expect(result).toEqual({ ok: false, code: "unavailable" });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "reward_setup", error: "credit balance is too low" }),
    );
  });

  it("refuses an answer that is not the agreed JSON", async () => {
    const { client } = fakeModel("Sure! Here are your rules: pay everyone more.");
    const result = await runRewardSetup({
      client,
      tree,
      workers: [],
      currency: "CZK",
      locale: "en",
      log: async () => {},
    });
    expect(result).toEqual({ ok: false, code: "unavailable" });
  });
});
