import { describe, expect, it } from "vitest";
import { effectiveTheme, isThemeAvailable, isThemeKey, THEMES } from "./themes";

describe("themes", () => {
  it("has six themes with Gradus first", () => {
    expect(THEMES).toEqual(["gradus", "midnight", "forest", "sunset", "steel", "light"]);
    expect(isThemeKey("forest")).toBe(true);
    expect(isThemeKey("aurora")).toBe(false);
    expect(isThemeKey(undefined)).toBe(false);
  });

  it("opens a theme in game mode only when unlocked; Gradus always", () => {
    const options = { locked: true, unlocked: ["theme_midnight", "section_contacts"] };
    expect(isThemeAvailable("gradus", options)).toBe(true);
    expect(isThemeAvailable("midnight", options)).toBe(true);
    expect(isThemeAvailable("light", options)).toBe(false);
    expect(isThemeAvailable("light", { locked: false, unlocked: [] })).toBe(true);
  });

  it("falls back to Gradus for a locked or unknown stored theme", () => {
    const options = { locked: true, unlocked: ["theme_midnight"] };
    expect(effectiveTheme("midnight", options)).toBe("midnight");
    expect(effectiveTheme("steel", options)).toBe("gradus");
    expect(effectiveTheme("nope", options)).toBe("gradus");
    expect(effectiveTheme(null, options)).toBe("gradus");
    expect(effectiveTheme("steel", { locked: false, unlocked: [] })).toBe("steel");
  });
});
