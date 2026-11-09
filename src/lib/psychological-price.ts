import { currencyDigits } from "./currency";

/**
 * A converted price rounded the way a shop would write it (step 24.1).
 *
 * The amount is looked at by its size and moved to the nearest "selling"
 * price of a grid; when the nearest one is more than MAX_DEVIATION (8 %) away
 * from the exact conversion, a finer grid is tried, and in the end the amount
 * is only rounded to cents. On a tie the higher price wins.
 *
 * Currencies with decimals (EUR, USD, CZK, GBP, PLN…):
 *   - under 20:       x,99   (0,99 · 4,99 · 19,99), else x,x9 (1,19 · 0,89)
 *   - 20 to 100:      x9     (29 · 49 · 99), else x,99 (23,99)
 *   - 100 to 1 000:   x90    (190 · 490 · 890), else x9 (119 · 459)
 *   - 1 000 to 10 000: x90   (1 890 · 4 590)
 *   - from 10 000:    x900   (12 900 · 48 900)
 * Currencies without decimals (JPY, KRW, HUF…) the same by size, with no
 * decimal endings: under 20 a whole number, 20–100 x9, 100–1 000 x90 or x9,
 * then x90 and x900 (JPY 2 990, KRW 28 900).
 */

export const MAX_DEVIATION = 0.08;

/** Candidates `k · step − end` for k = 1, 2, … */
type Grid = { step: number; end: number };

function gridsFor(amount: number, decimals: boolean): Grid[] {
  if (amount < 20) {
    return decimals
      ? [
          { step: 1, end: 0.01 },
          { step: 0.1, end: 0.01 },
        ]
      : [];
  }
  if (amount < 100) return decimals ? [{ step: 10, end: 1 }, { step: 1, end: 0.01 }] : [{ step: 10, end: 1 }];
  if (amount < 1_000) return [{ step: 100, end: 10 }, { step: 10, end: 1 }];
  const magnitude = 10 ** Math.floor(Math.log10(amount));
  // 1 000–9 999: x90 (step 100); 10 000–99 999: x900 (step 1 000); and so on.
  return [
    { step: magnitude / 10, end: magnitude / 100 },
    { step: magnitude / 100, end: magnitude / 1_000 },
  ].filter((grid) => grid.end >= (decimals ? 0.01 : 1));
}

const roundTo = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function nearestOnGrid(amount: number, { step, end }: Grid): number {
  const k = Math.max(1, Math.round((amount + end) / step));
  let best: number | null = null;
  for (const candidateK of [k - 1, k, k + 1]) {
    if (candidateK < 1) continue;
    const candidate = roundTo(candidateK * step - end, 2);
    if (candidate <= 0) continue;
    const distance = Math.abs(candidate - amount);
    const bestDistance = best === null ? Infinity : Math.abs(best - amount);
    // On a tie the higher price wins.
    if (distance < bestDistance - 1e-9 || (Math.abs(distance - bestDistance) <= 1e-9 && candidate > (best ?? 0))) {
      best = candidate;
    }
  }
  return best ?? roundTo(amount, 2);
}

/**
 * The selling price for an exact converted `amount` in `currency`; never more
 * than 8 % from it (for any amount a shop would charge, from a few cents up).
 */
export function psychologicalPrice(amount: number, currency: string): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const digits = currencyDigits(currency);
  const decimals = digits > 0;
  for (const grid of gridsFor(amount, decimals)) {
    const candidate = nearestOnGrid(amount, grid);
    if (Math.abs(candidate - amount) / amount <= MAX_DEVIATION) return roundTo(candidate, Math.min(digits, 2));
  }
  const places = Math.min(digits, 2);
  const rounded = roundTo(amount, places);
  return rounded > 0 ? rounded : 10 ** -places;
}
