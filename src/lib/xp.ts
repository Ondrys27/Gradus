/**
 * Level and progress from total XP. The server is the only place XP amounts
 * are decided (see award_xp() in the database); this is purely a display
 * curve, so it can change without touching stored data.
 *
 * Level n starts at 100 * (n-1) * n / 2 total XP (a triangular ramp: level 2
 * needs 100 XP, level 3 needs 300, level 4 needs 600, and so on).
 */
const XP_STEP = 100;

export function xpForLevel(level: number): number {
  const n = Math.max(1, level);
  return (XP_STEP * (n - 1) * n) / 2;
}

export function levelForXp(totalXp: number): number {
  if (totalXp <= 0) return 1;
  let level = 1;
  while (xpForLevel(level + 1) <= totalXp) level++;
  return level;
}

export type LevelProgress = {
  level: number;
  /** XP earned since this level started. */
  xpIntoLevel: number;
  /** XP needed to reach the next level from this one. */
  xpForNextLevel: number;
};

export function levelProgress(totalXp: number): LevelProgress {
  const level = levelForXp(totalXp);
  const floor = xpForLevel(level);
  return { level, xpIntoLevel: totalXp - floor, xpForNextLevel: xpForLevel(level + 1) - floor };
}
