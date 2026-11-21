/**
 * How the showcase's cursor moves and types (step 27.4), without the DOM:
 * a gentle curve between two points with an ease in and out, a duration that
 * grows with the distance, and typing at a human pace (a little slower after
 * a space or a comma). Everything comes from a seed, so the same scenario is
 * the same video every time.
 */

export type Point = { x: number; y: number };

/** A small deterministic generator (mulberry32): the same seed, the same numbers. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed from a text (a step key), so every step has its own steady wobble. */
export function seedOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Ease in and out (cubic): slow start, quick middle, soft landing. */
export function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

export const MOVE_MIN_MS = 380;
export const MOVE_MAX_MS = 1100;

/** A longer way takes longer, within a range that reads well on video. */
export function moveDuration(from: Point, to: Point): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.round(Math.min(MOVE_MAX_MS, Math.max(MOVE_MIN_MS, 300 + distance * 0.55)));
}

export type Curve = { from: Point; control1: Point; control2: Point; to: Point };

/**
 * A cubic Bézier from `from` to `to` that bows a little to one side, the way
 * a hand moves a mouse: never a ruler-straight line, never a wide arc.
 */
export function curveBetween(from: Point, to: Point, seed: number): Curve {
  const random = seededRandom(seed);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  // The unit normal of the line, and how far the curve leaves it (up to 12 %).
  const nx = -dy / distance;
  const ny = dx / distance;
  const bow = (random() * 0.24 - 0.12) * distance;
  return {
    from,
    control1: { x: from.x + dx * 0.3 + nx * bow, y: from.y + dy * 0.3 + ny * bow },
    control2: { x: from.x + dx * 0.75 + nx * bow * 0.5, y: from.y + dy * 0.75 + ny * bow * 0.5 },
    to,
  };
}

/** The point at `t` (0–1) on the curve. */
export function pointOnCurve(curve: Curve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * curve.from.x + b * curve.control1.x + c * curve.control2.x + d * curve.to.x,
    y: a * curve.from.y + b * curve.control1.y + c * curve.control2.y + d * curve.to.y,
  };
}

/** Where the cursor is `elapsed` ms into a move of `duration` ms along the curve. */
export function cursorAt(curve: Curve, elapsed: number, duration: number): Point {
  if (duration <= 0) return curve.to;
  return pointOnCurve(curve, easeInOut(elapsed / duration));
}

export const TYPE_MIN_MS = 45;
export const TYPE_MAX_MS = 140;

/**
 * The pause before each character: 55–110 ms, a little longer after a space
 * or punctuation (people look at what they wrote), always within the range.
 */
export function typingDelays(text: string, seed: number): number[] {
  const random = seededRandom(seed);
  const chars = [...text];
  return chars.map((char, index) => {
    let delay = 55 + random() * 55;
    const previous = chars[index - 1];
    if (previous === " ") delay += 25;
    if (previous && /[,.!?:;]/.test(previous)) delay += 60;
    if (char === char.toUpperCase() && char !== char.toLowerCase()) delay += 15;
    return Math.round(Math.min(TYPE_MAX_MS, Math.max(TYPE_MIN_MS, delay)));
  });
}

/** How long typing a text takes. */
export function typingDuration(text: string, seed: number): number {
  return typingDelays(text, seed).reduce((sum, delay) => sum + delay, 0);
}

/** The point a target is aimed at: a little off its centre, the way people click. */
export function aimAt(
  box: { left: number; top: number; width: number; height: number },
  seed: number,
): Point {
  const random = seededRandom(seed);
  const spreadX = Math.min(box.width * 0.18, 24);
  const spreadY = Math.min(box.height * 0.18, 8);
  return {
    x: Math.round(box.left + box.width / 2 + (random() * 2 - 1) * spreadX),
    y: Math.round(box.top + box.height / 2 + (random() * 2 - 1) * spreadY),
  };
}
