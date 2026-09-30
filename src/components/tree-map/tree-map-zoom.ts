/**
 * Zoom maths for the tree map, kept apart from React so it can be tested.
 *
 * Wheel events differ wildly between devices: a mouse notch is ~100 px (or 3
 * lines), a Mac trackpad pinch sends dozens of ctrlKey events a second with
 * small deltas. Each event is normalised to pixels, turned into a scale factor
 * and capped, so a pinch is as calm as a mouse wheel.
 */

export const MIN_SCALE = 0.3;
export const MAX_SCALE = 2;
/** Zoom buttons change the scale by 20 %. */
export const BUTTON_FACTOR = 1.2;
/** Every zoom eases out over this long. */
export const ZOOM_TIME = 200;

const LINE_HEIGHT = 20;
/** Scale change per normalised pixel: a mouse wheel scroll, and a trackpad pinch (ctrlKey). */
const WHEEL_SENSITIVITY = 0.0012;
const PINCH_SENSITIVITY = 0.008;
/** The most a single event may change the scale (as a factor): 7 % wheel, 3 % pinch. */
const MAX_WHEEL_STEP = Math.log(1.07);
const MAX_PINCH_STEP = Math.log(1.03);

export type WheelLike = { deltaY: number; deltaMode: number; ctrlKey: boolean };

/** deltaY in pixels whatever the delta mode (0 pixels, 1 lines, 2 pages). */
export function normalizeWheelDelta(event: WheelLike, pageHeight = 800): number {
  if (event.deltaMode === 1) return event.deltaY * LINE_HEIGHT;
  if (event.deltaMode === 2) return event.deltaY * pageHeight;
  return event.deltaY;
}

/** The factor one wheel event multiplies the scale by; scrolling up (negative deltaY) zooms in. */
export function wheelZoomFactor(event: WheelLike, pageHeight?: number): number {
  const pixels = normalizeWheelDelta(event, pageHeight);
  const pinch = event.ctrlKey;
  const change = -pixels * (pinch ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY);
  const limit = pinch ? MAX_PINCH_STEP : MAX_WHEEL_STEP;
  return Math.exp(Math.min(Math.max(change, -limit), limit));
}

export function clampScale(scale: number): number {
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

/** Cubic ease-out: quick start, soft landing. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return 1 - (1 - clamped) ** 3;
}

export type Transform = { x: number; y: number; scale: number };
/** A point of the viewport (relative to the map's wrapper) that stays put while zooming. */
export type Anchor = { x: number; y: number };

/**
 * One frame of a zoom from `from.scale` to `toScale`, `progress` 0…1. The scale is
 * interpolated in log space (even steps feel even at any zoom), and the content
 * point under the anchor stays under the anchor the whole way.
 */
export function zoomFrame(
  from: Transform,
  toScale: number,
  anchor: Anchor,
  progress: number,
): Transform {
  const eased = easeOutCubic(progress);
  const scale = Math.exp(Math.log(from.scale) + (Math.log(toScale) - Math.log(from.scale)) * eased);
  const contentX = (anchor.x - from.x) / from.scale;
  const contentY = (anchor.y - from.y) / from.scale;
  return { x: anchor.x - contentX * scale, y: anchor.y - contentY * scale, scale };
}
