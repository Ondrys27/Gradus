import type { JarvisDirection } from "@/components/jarvis/jarvis-pose";
import { pointDirection, type Box, type Size } from "@/features/jarvis/tour";
import type { PlannedStep } from "./engine";
import type { TutorialChapter } from "./steps";

/**
 * How the tutorial is presented, without React: the chapter rail at the top
 * instead of "step 7 of 31", the emphasised verb in what Jarvis says, which
 * short reaction he gives once a hands-on step is done, where he stands next
 * to the element of a hands-on step and which end of a phone the bubble
 * takes so it never covers the button the user has to press.
 */

export type RailSegment = {
  chapter: TutorialChapter;
  /** Steps in this chapter, as a share of the whole (0–1). */
  share: number;
  state: "done" | "current" | "ahead";
  /** Progress inside the current chapter (0–1); 1 when done, 0 when ahead. */
  fill: number;
};

/** The chapters in order with how far the user is; a chapter spans its steps. */
export function chapterRail(steps: readonly PlannedStep[], index: number): RailSegment[] {
  if (steps.length === 0) return [];
  const at = Math.min(Math.max(index, 0), steps.length - 1);
  const segments: { chapter: TutorialChapter; count: number; first: number }[] = [];
  steps.forEach((step, position) => {
    const last = segments[segments.length - 1];
    if (last && last.chapter === step.chapter) last.count += 1;
    else segments.push({ chapter: step.chapter, count: 1, first: position });
  });
  return segments.map((segment) => {
    const end = segment.first + segment.count - 1;
    if (end < at)
      return {
        chapter: segment.chapter,
        share: segment.count / steps.length,
        state: "done",
        fill: 1,
      };
    if (segment.first > at) {
      return {
        chapter: segment.chapter,
        share: segment.count / steps.length,
        state: "ahead",
        fill: 0,
      };
    }
    // The current step counts as reached: the first step of a chapter already shows a sliver.
    const fill = (at - segment.first + 1) / (segment.count + 1);
    return {
      chapter: segment.chapter,
      share: segment.count / steps.length,
      state: "current",
      fill,
    };
  });
}

export type TextPart = { text: string; strong: boolean };

/**
 * `**word**` in a translated line is the verb of the action, shown
 * emphasised. Unbalanced markers are left as plain text.
 */
export function emphasize(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start), strong: false });
    parts.push({ text: match[1]!, strong: true });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), strong: false });
  return parts;
}

/** The plain text of a line, markers removed (for screen readers and measuring). */
export function plainText(text: string): string {
  return emphasize(text)
    .map((part) => part.text)
    .join("");
}

/** The first `count` characters of emphasised parts, so a typed line keeps its emphasis. */
export function sliceParts(parts: readonly TextPart[], count: number): TextPart[] {
  const out: TextPart[] = [];
  let left = Math.max(0, count);
  for (const part of parts) {
    if (left <= 0) break;
    const text = part.text.slice(0, left);
    out.push({ text, strong: part.strong });
    left -= text.length;
  }
  return out;
}

/**
 * Which of the short reactions a finished step gets: fixed per step (the
 * same step says the same thing again after a reload), different between
 * neighbouring steps.
 */
export function reactionIndex(stepKey: string, count: number): number {
  if (count <= 0) return 0;
  let hash = 0;
  for (const char of stepKey) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % count;
}

/** On a phone the bubble takes the end of the screen away from the element. */
export function phoneBubbleEnd(box: Box | null, viewport: Size): "top" | "bottom" {
  if (!box) return "bottom";
  const centre = box.top + box.height / 2;
  return centre < viewport.height / 2 ? "bottom" : "top";
}

export type Companion = { left: number; top: number; direction: JarvisDirection };

/**
 * Where Jarvis stands next to the element of a hands-on step on a larger
 * screen: below it when it sits in the upper part of the page (a header
 * button: the room below is usually free, the buttons beside it are not),
 * else to its left when there is room, else to its right, else below
 * anyway; never off screen and never over the element. `direction` is
 * where he points.
 */
export function companionPlacement(
  box: Box,
  viewport: Size,
  size: number,
  gap = 14,
  margin = 8,
): Companion {
  const centreX = box.left + box.width / 2;
  const centreY = box.top + box.height / 2;
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max));
  const bottom = box.top + box.height;
  const roomBelow = bottom + gap + size <= viewport.height - margin;
  const high = centreY < viewport.height * 0.4;
  let left: number;
  let top: number;
  if (high && roomBelow) {
    left = centreX - size / 2;
    top = bottom + gap;
  } else if (box.left - gap - size >= margin) {
    left = box.left - gap - size;
    top = centreY - size / 2;
  } else if (box.left + box.width + gap + size <= viewport.width - margin) {
    left = box.left + box.width + gap;
    top = centreY - size / 2;
  } else {
    left = centreX - size / 2;
    top = bottom + gap;
  }
  left = clamp(left, margin, viewport.width - margin - size);
  top = clamp(top, margin, viewport.height - margin - size);
  const direction = pointDirection(centreX - (left + size / 2), centreY - (top + size * 0.4));
  return { left, top, direction };
}
