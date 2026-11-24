import { describe, expect, it } from "vitest";
import { cacheConversation, chatMessageCost, conversationCacheSaving, likelyToolUse } from "./cache";

const shape = {
  model: "claude-sonnet-5-5" as const,
  fixedTokens: 10_000,
  contextTokens: 4_000,
  perRoundTokens: 1_000,
  outputTokens: 300,
};

describe("caching the chat's conversation", () => {
  it("is on when the chat offers tools and the message asks for one", () => {
    expect(cacheConversation(true, "Založ mi úkol zavolat paní Lípové")).toBe(true);
    expect(cacheConversation(true, "Které obchody nemají úkol?")).toBe(true);
    expect(cacheConversation(true, "Add a task for tomorrow")).toBe(true);
    expect(cacheConversation(false, "Založ mi úkol")).toBe(false);
    expect(cacheConversation(true, "Díky, to pomohlo!")).toBe(false);
    expect(cacheConversation(true)).toBe(false);
    // A stem at the start of a word only: "nezměnil" is not "změň".
    expect(likelyToolUse("To se nezmenilo, díky")).toBe(false);
  });

  it("costs the write premium on a message answered in one round", () => {
    // Context 4,000 at 2.5 instead of 2 USD per million: 0.002 USD more.
    expect(chatMessageCost({ ...shape, rounds: 1 }, true) - chatMessageCost({ ...shape, rounds: 1 }, false)).toBeCloseTo(0.002, 6);
    expect(conversationCacheSaving({ ...shape, rounds: 1 })).toBeLessThan(0);
  });

  it("saves more with every further round", () => {
    const two = conversationCacheSaving({ ...shape, rounds: 2 });
    const four = conversationCacheSaving({ ...shape, rounds: 4 });
    expect(two).toBeGreaterThan(0.15);
    expect(four).toBeGreaterThan(two);
  });
});
