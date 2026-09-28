import { describe, expect, it } from "vitest";
import { toModelMessages } from "./history";

describe("toModelMessages", () => {
  it("starts with the user, dropping an answer cut from its question", () => {
    expect(
      toModelMessages([
        { role: "assistant", content: "old answer" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "plan my day" },
      ]),
    ).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "plan my day" },
    ]);
  });

  it("keeps an unanswered turn next to the following one", () => {
    expect(
      toModelMessages([
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ]),
    ).toHaveLength(2);
  });

  it("is empty without a user message", () => {
    expect(toModelMessages([{ role: "assistant", content: "x" }])).toEqual([]);
  });
});
