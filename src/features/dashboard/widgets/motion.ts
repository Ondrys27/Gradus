/**
 * How the board moves (28.6), without React: the springs, the wiggle of each
 * widget with its own phase, and a short haptic tick where the browser has one.
 */

/** Widgets glide to a new place and morph to a new size with this spring. */
export const LAYOUT_SPRING = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;
/** A widget flying in from the gallery, or settling after a drop. */
export const ARRIVE_SPRING = { type: "spring", stiffness: 300, damping: 28, mass: 1 } as const;
/** The lift of a grabbed widget. */
export const LIFT_SPRING = { type: "spring", stiffness: 520, damping: 30 } as const;
/** A removed widget shrinks away in this time (s). */
export const SHRINK_SECONDS = 0.22;

/** A small stable number in [0, 1) from a widget's id (FNV-1a), the same on every render. */
export function phaseOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % 1000) / 1000;
}

/**
 * The wiggle of one widget in editing: every widget has its own phase and a
 * slightly different period, so the board shivers like a shelf of loose
 * things, not like one machine. Delay is negative: the animation is already
 * under way when editing starts.
 */
export function wiggleOf(id: string): { delay: number; duration: number; angle: number } {
  const phase = phaseOf(id);
  const second = phaseOf(`${id}:period`);
  const duration = 0.3 + second * 0.12;
  return {
    delay: -phase * duration * 2,
    duration,
    angle: 0.55 + phaseOf(`${id}:angle`) * 0.35,
  };
}

/** A short tick on a phone that has it; nothing anywhere else. */
export function haptic(kind: "tick" | "lift" | "drop" | "remove" = "tick") {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  const pattern = { tick: 8, lift: 14, drop: [6, 30, 10], remove: [10, 40, 18] }[kind];
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw without a user gesture; a missing tick is fine.
  }
}

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * The transform that puts an element of `to` over `from`: where a widget
 * flies from (the gallery preview) to where it landed on the board.
 */
export function flightFrom(from: Rect, to: Rect): { x: number; y: number; scaleX: number; scaleY: number } {
  const scaleX = to.width > 0 ? from.width / to.width : 1;
  const scaleY = to.height > 0 ? from.height / to.height : 1;
  return {
    x: from.x + from.width / 2 - (to.x + to.width / 2),
    y: from.y + from.height / 2 - (to.y + to.height / 2),
    scaleX: Math.max(0.05, scaleX),
    scaleY: Math.max(0.05, scaleY),
  };
}
