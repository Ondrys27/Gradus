import { describe, expect, it } from "vitest";
import { initialsOf } from "./avatar";

describe("initialsOf", () => {
  it("takes the first and last word", () => {
    expect(initialsOf("Ondřej Otava")).toBe("OO");
    expect(initialsOf("anna marie novak")).toBe("AN");
  });

  it("falls back to the e-mail name and handles empty input", () => {
    expect(initialsOf("ondra.otava@example.com")).toBe("OO");
    expect(initialsOf("šimon")).toBe("Š");
    expect(initialsOf("")).toBe("");
    expect(initialsOf(null)).toBe("");
  });
});
