import { describe, expect, it } from "vitest";
import {
  applyAnimationsEnabled,
  isAnimationsEnabled,
  resetAnimationsPreference,
} from "./animation-preference";

describe("animation preference", () => {
  it("is on by default, follows the settings and resets on sign-out", () => {
    expect(isAnimationsEnabled()).toBe(true);
    applyAnimationsEnabled(false);
    expect(isAnimationsEnabled()).toBe(false);
    resetAnimationsPreference();
    expect(isAnimationsEnabled()).toBe(true);
  });
});
