import type { JarvisDirection } from "@/components/jarvis/jarvis-pose";

/**
 * The guided tour as data: which steps an account gets and where Jarvis
 * stands for each. Targets are `data-tour` attributes on the app's own
 * elements; the first visible one is used, so the sidebar on a desktop and
 * the bottom bar on a phone both work.
 */

export type TourStepKey =
  | "dashboard"
  | "milestones"
  | "jarvis"
  | "level"
  | "search"
  | "settings"
  | "finish"
  | "workerDashboard"
  | "workerTasks"
  | "workerFinish";

export type TourStep = { key: TourStepKey; target: string | null };

/**
 * Seven steps for an owner (the level step only in game mode), a short
 * version for a worker's own environment.
 */
export function tourSteps(options: { worker: boolean; playing: boolean }): TourStep[] {
  if (options.worker) {
    return [
      { key: "workerDashboard", target: "nav-dashboard" },
      { key: "workerTasks", target: "nav-myTasks" },
      { key: "jarvis", target: "jarvis" },
      { key: "settings", target: "account" },
      { key: "workerFinish", target: null },
    ];
  }
  const steps: TourStep[] = [
    { key: "dashboard", target: "nav-dashboard" },
    { key: "milestones", target: "nav-milestones" },
    { key: "jarvis", target: "jarvis" },
    { key: "level", target: "level" },
    { key: "search", target: "search" },
    { key: "settings", target: "account" },
    { key: "finish", target: null },
  ];
  return options.playing ? steps : steps.filter((step) => step.key !== "level");
}

export type Box = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };

export type Placement = {
  top: number;
  left: number;
  /** Below or above the target, or centred when there is none. */
  side: "below" | "above" | "center";
  /** Jarvis stands at the right end of the callout (the target is on the right). */
  flip: boolean;
  direction: JarvisDirection;
};

/** Which way the arm points, from Jarvis's centre to the target's (screen coordinates). */
export function pointDirection(dx: number, dy: number): JarvisDirection {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax > ay * 2.5) return dx < 0 ? "left" : "right";
  if (dy > 0) return "down";
  if (ax < ay * 0.5) return "up";
  return dx < 0 ? "up-left" : "up-right";
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Where the callout (Jarvis plus his bubble) goes: below the target when it
 * fits, otherwise above, with Jarvis at the end closest to the target and
 * never outside the screen. Jarvis sits at the callout's top when below and
 * at its bottom when above, `character` px wide.
 */
export function placeCallout(
  target: Box | null,
  callout: Size,
  viewport: Size,
  character: number,
  margin = 16,
  gap = 12,
): Placement {
  if (!target) {
    return {
      top: Math.max(margin, (viewport.height - callout.height) / 2),
      left: Math.max(margin, (viewport.width - callout.width) / 2),
      side: "center",
      flip: false,
      direction: "down",
    };
  }
  const centerX = target.left + target.width / 2;
  const centerY = target.top + target.height / 2;
  const bottom = target.top + target.height;
  const roomBelow = viewport.height - margin - (bottom + gap);
  const roomAbove = target.top - gap - margin;
  const side: "below" | "above" =
    roomBelow >= callout.height || roomBelow >= roomAbove ? "below" : "above";
  const top = clamp(
    side === "below" ? bottom + gap : target.top - gap - callout.height,
    margin,
    viewport.height - margin - callout.height,
  );

  const flip = centerX > viewport.width / 2;
  const offset = flip ? callout.width - character / 2 : character / 2;
  const left = clamp(centerX - offset, margin, viewport.width - margin - callout.width);

  const characterX = left + offset;
  const characterY = side === "below" ? top + character / 2 : top + callout.height - character / 2;
  return {
    top,
    left,
    side,
    flip,
    direction: pointDirection(centerX - characterX, centerY - characterY),
  };
}

/** The first element with this `data-tour` value (an internal name) that is actually on screen. */
export function findTourTarget(name: string, root: ParentNode = document): HTMLElement | null {
  const nodes = root.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const node of nodes) {
    const box = node.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return node;
  }
  return null;
}
