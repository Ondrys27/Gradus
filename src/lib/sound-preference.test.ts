import { describe, expect, it } from "vitest";
import { applySoundEnabled, isSoundEnabled, resetSoundPreference } from "./sound-preference";

describe("sound preference", () => {
  it("is on by default, follows the settings and resets on sign-out", () => {
    expect(isSoundEnabled()).toBe(true);
    applySoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    resetSoundPreference();
    expect(isSoundEnabled()).toBe(true);
  });
});
