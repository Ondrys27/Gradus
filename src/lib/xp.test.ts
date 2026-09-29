import { describe, expect, it } from "vitest";
import { levelForXp, levelProgress, xpForLevel } from "./xp";

describe("xpForLevel", () => {
  it("starts level 1 at zero", () => {
    expect(xpForLevel(1)).toBe(0);
  });

  it("ramps up the triangular thresholds", () => {
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(300);
    expect(xpForLevel(4)).toBe(600);
  });
});

describe("levelForXp", () => {
  it("is level 1 below the first threshold", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
  });

  it("reaches the next level exactly at its threshold", () => {
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(299)).toBe(2);
    expect(levelForXp(300)).toBe(3);
  });

  it("never returns a level below 1", () => {
    expect(levelForXp(-50)).toBe(1);
  });
});

describe("levelProgress", () => {
  it("reports progress within the current level", () => {
    expect(levelProgress(150)).toEqual({ level: 2, xpIntoLevel: 50, xpForNextLevel: 200 });
  });

  it("resets at a level boundary", () => {
    expect(levelProgress(300)).toEqual({ level: 3, xpIntoLevel: 0, xpForNextLevel: 300 });
  });
});
