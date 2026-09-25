/** Hours shown in the grid, 7:00 to 20:59 local time. */
export const HOURS = Array.from({ length: 14 }, (_, index) => 7 + index);
/** Monday first, Sunday last (0 = Sunday, as in the database). */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
/** A cell with fewer attempts says nothing yet. */
export const MIN_CELL_ATTEMPTS = 20;
/** A country with fewer attempts is not shown at all. */
export const MIN_COUNTRY_ATTEMPTS = 200;

export type StatRow = { day_of_week: number; hour: number; attempts: number; meetings: number };

export type Cell = {
  day: number;
  hour: number;
  attempts: number;
  meetings: number;
  /** Meetings per attempt, or null when there is too little data. */
  share: number | null;
  /** 0–1 against the best cell, for the colour; null when there is too little data. */
  level: number | null;
};

export type Heatmap = {
  rows: { day: number; cells: Cell[] }[];
  totalAttempts: number;
  enough: boolean;
};

export function buildHeatmap(stats: StatRow[]): Heatmap {
  const byKey = new Map(stats.map((row) => [`${row.day_of_week}:${row.hour}`, row]));
  const totalAttempts = stats.reduce((sum, row) => sum + row.attempts, 0);

  const rows = WEEKDAYS.map((day) => ({
    day,
    cells: HOURS.map((hour): Cell => {
      const row = byKey.get(`${day}:${hour}`);
      const attempts = row?.attempts ?? 0;
      const meetings = row?.meetings ?? 0;
      const share = attempts >= MIN_CELL_ATTEMPTS ? meetings / attempts : null;
      return { day, hour, attempts, meetings, share, level: null };
    }),
  }));

  const best = Math.max(0, ...rows.flatMap((row) => row.cells.map((cell) => cell.share ?? 0)));
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.share !== null) cell.level = best > 0 ? cell.share / best : 0;
    }
  }
  return { rows, totalAttempts, enough: totalAttempts >= MIN_COUNTRY_ATTEMPTS };
}
