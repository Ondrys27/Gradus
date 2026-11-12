import { describe, expect, it } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { RENAMED_SKILL_TEXT, unlockDescription } from "./skill-text";

describe("unlockDescription", () => {
  const t = (key: string) => `t:${key}`;

  it("words the assistant's skills from the translations, not the stored text", () => {
    expect(
      unlockDescription("jarvis_morning_brief", { en: "Jarvis sums up", cs: "Jarvis shrne" }, "cs", t),
    ).toBe("t:skillText.morningBrief");
  });

  it("keeps every other stored text", () => {
    expect(unlockDescription("theme_gold", { en: "Gold", cs: "Zlatá" }, "cs", t)).toBe("Zlatá");
    expect(unlockDescription("theme_gold", null, "en", t)).toBe("");
  });

  it("has every text in both languages, none with the old name", () => {
    for (const messages of [cs, en]) {
      const texts = messages.game.skillText as Record<string, string>;
      for (const name of Object.values(RENAMED_SKILL_TEXT)) {
        expect(texts[name], name).toBeTruthy();
        expect(texts[name]).not.toMatch(/Jarvis/);
      }
    }
  });
});
