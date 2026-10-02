import { describe, expect, it } from "vitest";
import {
  achievementProgress,
  cappedXp,
  computeStreak,
  dailyLoginXp,
  DAILY_CAPS,
  dealWonXp,
  levelForXp,
  levelProgress,
  MAX_LEVEL,
  newlyEarnedAchievements,
  tierForLevel,
  xpForLevel,
  type AchievementRule,
} from "./rules";

describe("levels", () => {
  it("needs round(120 · n^1.6) total XP for level n, level 1 at 0", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(364);
    expect(xpForLevel(3)).toBe(696);
    expect(xpForLevel(10)).toBe(4777);
    expect(xpForLevel(30)).toBe(Math.round(120 * 30 ** 1.6));
  });

  it("climbs strictly and stops at level 30", () => {
    for (let level = 2; level <= MAX_LEVEL; level++) {
      expect(xpForLevel(level)).toBeGreaterThan(xpForLevel(level - 1));
    }
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-50)).toBe(1);
    expect(levelForXp(363)).toBe(1);
    expect(levelForXp(364)).toBe(2);
    expect(levelForXp(xpForLevel(30) - 1)).toBe(29);
    expect(levelForXp(xpForLevel(30))).toBe(30);
    expect(levelForXp(10_000_000)).toBe(30);
  });

  it("reports progress inside a level and a full bar at the top", () => {
    expect(levelProgress(500)).toEqual({
      level: 2,
      xpIntoLevel: 136,
      xpForNextLevel: 332,
      ratio: 136 / 332,
    });
    const top = levelProgress(xpForLevel(30) + 1000);
    expect(top.level).toBe(30);
    expect(top.xpForNextLevel).toBe(0);
    expect(top.ratio).toBe(1);
  });

  it("names a tier every five levels", () => {
    expect(tierForLevel(1)).toBe("apprentice");
    expect(tierForLevel(5)).toBe("apprentice");
    expect(tierForLevel(6)).toBe("trader");
    expect(tierForLevel(15)).toBe("dealmaker");
    expect(tierForLevel(16)).toBe("entrepreneur");
    expect(tierForLevel(25)).toBe("strategist");
    expect(tierForLevel(26)).toBe("legend");
    expect(tierForLevel(30)).toBe("legend");
  });
});

describe("XP amounts and caps", () => {
  it("pays a won deal 150 + 1 per full 1 000, the bonus capped at 150", () => {
    expect(dealWonXp(null)).toBe(150);
    expect(dealWonXp(999)).toBe(150);
    expect(dealWonXp(5_500)).toBe(155);
    expect(dealWonXp(150_000)).toBe(300);
    expect(dealWonXp(2_000_000)).toBe(300);
    expect(dealWonXp(-10_000)).toBe(150);
  });

  it("multiplies the login by the streak, between ×1 and ×3", () => {
    expect(dailyLoginXp(0)).toBe(10);
    expect(dailyLoginXp(1)).toBe(10);
    expect(dailyLoginXp(2)).toBe(20);
    expect(dailyLoginXp(3)).toBe(30);
    expect(dailyLoginXp(40)).toBe(30);
  });

  it("trims an award to what is left of today's cap", () => {
    expect(cappedXp(5, 0, DAILY_CAPS.contact_moved)).toBe(5);
    expect(cappedXp(5, 47, DAILY_CAPS.contact_moved)).toBe(3);
    expect(cappedXp(5, 50, DAILY_CAPS.contact_moved)).toBe(0);
    expect(cappedXp(5, 80, DAILY_CAPS.contact_moved)).toBe(0);
    expect(cappedXp(300, 1_000_000, undefined)).toBe(300);
  });

  it("caps the sources the brief names", () => {
    expect(DAILY_CAPS.contact_moved).toBe(50);
    expect(DAILY_CAPS.contact_generated).toBe(30);
    expect(DAILY_CAPS.calendar_event).toBe(25);
    expect(DAILY_CAPS.transaction_added).toBe(25);
  });

  it("lets ten moves a day count and no more", () => {
    let used = 0;
    const paid: number[] = [];
    for (let i = 0; i < 12; i++) {
      const xp = cappedXp(5, used, DAILY_CAPS.contact_moved);
      used += xp;
      paid.push(xp);
    }
    expect(paid.filter((xp) => xp > 0)).toHaveLength(10);
    expect(used).toBe(50);
  });
});

describe("computeStreak", () => {
  // 2026-10-07 is a Wednesday; its week starts Monday 2026-10-05.
  const today = "2026-10-07";

  it("counts consecutive active days and lets an empty today wait", () => {
    expect(computeStreak([], today)).toEqual({ streak: 0, freezeAvailable: true });
    expect(computeStreak(["2026-10-07"], today).streak).toBe(1);
    expect(computeStreak(["2026-10-06", "2026-10-05"], today).streak).toBe(2);
    expect(computeStreak(["2026-10-07", "2026-10-06", "2026-10-05"], today).streak).toBe(3);
  });

  it("bridges one missed day per week and spends that week's save", () => {
    // Missed Tuesday 6th, saved by this week's save.
    const result = computeStreak(["2026-10-07", "2026-10-05", "2026-10-04"], today);
    expect(result).toEqual({ streak: 3, freezeAvailable: false });
  });

  it("breaks on a second missed day in the same week", () => {
    // Missed Tue 6th and Mon 5th: same week.
    expect(computeStreak(["2026-10-07", "2026-10-04", "2026-10-03"], today)).toEqual({
      streak: 1,
      freezeAvailable: true,
    });
  });

  it("can bridge once in each week", () => {
    // Missed Sunday 4th (last week) and Tuesday 6th (this week).
    const days = ["2026-10-07", "2026-10-05", "2026-10-03", "2026-10-02"];
    expect(computeStreak(days, today)).toEqual({ streak: 4, freezeAvailable: false });
  });

  it("spends no save on a gap that leads nowhere", () => {
    expect(computeStreak(["2026-10-07"], today)).toEqual({ streak: 1, freezeAvailable: true });
  });
});

describe("achievements", () => {
  const rules: AchievementRule[] = [
    { key: "first_task", condition: { metric: "tasks_done", gte: 1 } },
    { key: "marathon", condition: { metric: "tasks_done", gte: 100 } },
    { key: "networker", condition: { metric: "contacts", gte: 50 } },
    { key: "caller", condition: { metric: "call_seconds", gte: 36_000 } },
    { key: "streak_7", condition: { metric: "streak", gte: 7 } },
    { key: "mapper", condition: { metric: "task_depth", gte: 3 } },
  ];

  it("earns exactly the badges whose threshold is reached", () => {
    expect(
      newlyEarnedAchievements(
        rules,
        { tasks_done: 99, contacts: 50, call_seconds: 35_999, streak: 7, task_depth: 2 },
        [],
      ),
    ).toEqual(["first_task", "networker", "streak_7"]);
  });

  it("never earns a badge twice and treats a missing metric as zero", () => {
    expect(newlyEarnedAchievements(rules, { tasks_done: 100 }, ["first_task"])).toEqual([
      "marathon",
    ]);
    expect(newlyEarnedAchievements(rules, {}, [])).toEqual([]);
  });

  it("shows progress towards a badge, capped at 1", () => {
    expect(achievementProgress({ metric: "contacts", gte: 50 }, { contacts: 25 })).toBe(0.5);
    expect(achievementProgress({ metric: "contacts", gte: 50 }, { contacts: 80 })).toBe(1);
    expect(achievementProgress({ metric: "contacts", gte: 50 }, {})).toBe(0);
  });
});
