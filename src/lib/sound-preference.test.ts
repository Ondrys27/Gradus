import { describe, expect, it } from "vitest";
import { isSoundEnabled, setSoundEnabled } from "./sound-preference";

describe("sound preference", () => {
  it("is on by default and remembers being turned off", () => {
    expect(isSoundEnabled()).toBe(true);
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    expect(window.localStorage.getItem("gradus.sound")).toBe("off");
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });
});
