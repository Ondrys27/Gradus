/**
 * Jarvis's poses as plain data, so the drawing stays dumb and the rules can be tested.
 * Angles are in degrees, clockwise positive (SVG). Offsets are in viewBox units.
 */

export const JARVIS_STATES = [
  "idle",
  "thinking",
  "happy",
  "waving",
  "pointing",
  "surprised",
  "sleeping",
] as const;
export type JarvisState = (typeof JARVIS_STATES)[number];

export const JARVIS_DIRECTIONS = ["left", "up-left", "up", "up-right", "right", "down"] as const;
export type JarvisDirection = (typeof JARVIS_DIRECTIONS)[number];

/** The three sizes the design uses: the corner button, a speech bubble, onboarding and celebrations. */
export const JARVIS_SIZES = { button: 64, bubble: 140, stage: 240 } as const;

export type EyeShape = "open" | "arc" | "closed";
export type MouthShape = "smile" | "wide" | "o" | "flat";

export type JarvisPose = {
  eyes: EyeShape;
  eyeScaleX: number;
  eyeScaleY: number;
  /** Where the eyes look when they are not following the pointer. */
  eyeLook: { x: number; y: number };
  mouth: MouthShape;
  /** Whole-body lean. */
  lean: number;
  headTilt: number;
  /** Arms hang down at 0; the left arm swings outwards with positive angles, the right with negative. */
  leftArm: number;
  rightArm: number;
  /** Resting glow of the antenna ball, 0–1. */
  antennaGlow: number;
  trackPointer: boolean;
};

/** How far the eyes may travel across the display. */
export const EYE_TRAVEL = { x: 3.2, y: 2.2 } as const;

const ARM_REST = 12;

const REST: JarvisPose = {
  eyes: "open",
  eyeScaleX: 1,
  eyeScaleY: 1,
  eyeLook: { x: 0, y: 0 },
  mouth: "smile",
  lean: 0,
  headTilt: 0,
  leftArm: ARM_REST,
  rightArm: -ARM_REST,
  antennaGlow: 0.7,
  trackPointer: false,
};

/** Unit vector for a pointing direction, screen coordinates (y grows downwards). */
export function directionVector(direction: JarvisDirection): { x: number; y: number } {
  const d = Math.SQRT1_2;
  switch (direction) {
    case "left":
      return { x: -1, y: 0 };
    case "up-left":
      return { x: -d, y: -d };
    case "up":
      return { x: 0, y: -1 };
    case "up-right":
      return { x: d, y: -d };
    case "right":
      return { x: 1, y: 0 };
    case "down":
      return { x: 0, y: 1 };
  }
}

/**
 * Which arm points and at what angle. Up and down use the right arm; left-hand
 * directions use the left arm so it never crosses the body.
 */
export function pointingArms(direction: JarvisDirection): { leftArm: number; rightArm: number } {
  switch (direction) {
    case "left":
      return { leftArm: 90, rightArm: -ARM_REST };
    case "up-left":
      return { leftArm: 135, rightArm: -ARM_REST };
    case "up":
      return { leftArm: ARM_REST, rightArm: -172 };
    case "up-right":
      return { leftArm: ARM_REST, rightArm: -135 };
    case "right":
      return { leftArm: ARM_REST, rightArm: -90 };
    case "down":
      return { leftArm: ARM_REST, rightArm: -28 };
  }
}

export function poseFor(state: JarvisState, direction: JarvisDirection = "right"): JarvisPose {
  switch (state) {
    case "idle":
      return { ...REST, trackPointer: true };
    case "thinking":
      return {
        ...REST,
        eyeScaleY: 0.5,
        eyeScaleX: 1.08,
        eyeLook: { x: 2, y: -1.6 },
        mouth: "flat",
        lean: -5,
        headTilt: -4,
        rightArm: -34,
      };
    case "happy":
      return {
        ...REST,
        eyes: "arc",
        mouth: "wide",
        leftArm: 38,
        rightArm: -38,
        antennaGlow: 1,
      };
    case "waving":
      return { ...REST, mouth: "wide", headTilt: 7, rightArm: -135, eyeLook: { x: 1, y: -0.5 } };
    case "pointing": {
      const v = directionVector(direction);
      return {
        ...REST,
        ...pointingArms(direction),
        eyeLook: { x: v.x * EYE_TRAVEL.x, y: v.y * EYE_TRAVEL.y },
        headTilt: v.x * 5,
        lean: v.x * 3,
      };
    }
    case "surprised":
      return {
        ...REST,
        eyeScaleX: 1.22,
        eyeScaleY: 1.22,
        mouth: "o",
        leftArm: 30,
        rightArm: -30,
        antennaGlow: 1,
      };
    case "sleeping":
      return {
        ...REST,
        eyes: "closed",
        mouth: "flat",
        headTilt: 6,
        leftArm: 4,
        rightArm: -4,
        antennaGlow: 0.25,
      };
  }
}

/**
 * Eye offset towards a point. Stays within the display and eases in, so a cursor
 * right next to Jarvis does not make the eyes snap to the edge.
 * @param range distance (same units as dx/dy) at which the eyes reach full travel
 */
export function lookToward(
  dx: number,
  dy: number,
  range: number,
  travel: { x: number; y: number } = EYE_TRAVEL,
): { x: number; y: number } {
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance === 0 || range <= 0) return { x: 0, y: 0 };
  const reach = Math.min(1, distance / range);
  return { x: (dx / distance) * travel.x * reach, y: (dy / distance) * travel.y * reach };
}

/** 4–6 s between blinks, never on a beat. */
export function nextBlinkDelay(random: () => number = Math.random): number {
  return 4000 + Math.min(1, Math.max(0, random())) * 2000;
}

/** Wait before the next idle head tilt, 6–10 s. */
export function nextTiltDelay(random: () => number = Math.random): number {
  return 6000 + Math.min(1, Math.max(0, random())) * 4000;
}
