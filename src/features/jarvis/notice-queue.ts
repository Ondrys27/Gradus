/**
 * One notice of Jarvis at a time: the order of the queue and where the card
 * goes when something is skipped, closed or done. Plain functions shared by
 * his bubble (proactive-jarvis) and the "Jarvis noticed" card of his panel.
 * No zod and no React here: the browser loads it with the first page.
 */

/**
 * How urgent a suggestion type is, lower first: an automatic change that can
 * still be undone, then what is late or waits on people, then the rest.
 * Unknown types go last.
 */
export const SUGGESTION_URGENCY: Record<string, number> = {
  taskCompleted: 0,
  overdueTask: 1,
  overdueInvoice: 1,
  followUps: 2,
  stalledDeal: 3,
  milestoneReady: 4,
  dealWon: 5,
  pathReady: 6,
  insight: 7,
};
const UNKNOWN_URGENCY = 99;

export type QueuedNotice = {
  type: string;
  createdAt: string;
  /** A call outside the time window waits for the next one; it is less urgent than what can be done now. */
  notBefore?: string | null;
};

export function urgencyOf(type: string): number {
  return SUGGESTION_URGENCY[type] ?? UNKNOWN_URGENCY;
}

/**
 * The queue order: what can be done now before what has to wait, the most
 * urgent type first, then the newest. A new array; ties keep their order.
 */
export function orderNotices<T extends QueuedNotice>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      Number(Boolean(a.notBefore)) - Number(Boolean(b.notBefore)) ||
      urgencyOf(a.type) - urgencyOf(b.type) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/** One step through the queue, round at both ends. */
export function stepIndex(index: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (((index + delta) % total) + total) % total;
}

/**
 * Which notice the card shows after the queue changed. The one on screen
 * stays when it is still there (a new notice never pushes it away); when it
 * went (closed or done), the next one takes its place: the first that
 * followed it and is still queued, round to the start after the last one.
 * Skipped notices stay in the queue, so they are found again this way.
 */
export function resolveCurrent(
  previousIds: readonly string[],
  currentId: string | null,
  nextIds: readonly string[],
): string | null {
  if (!nextIds.length) return null;
  if (currentId && nextIds.includes(currentId)) return currentId;
  const at = currentId ? previousIds.indexOf(currentId) : -1;
  if (at >= 0) {
    const remaining = new Set(nextIds);
    for (let step = 1; step < previousIds.length; step += 1) {
      const id = previousIds[(at + step) % previousIds.length]!;
      if (remaining.has(id)) return id;
    }
  }
  return nextIds[0]!;
}

/** At most this many dots; a longer queue slides them along with the card. */
export const MAX_DOTS = 5;

/** The dots to draw: positions [start, end) of the queue, the current one among them. */
export function dotWindow(
  index: number,
  total: number,
  max: number = MAX_DOTS,
): { start: number; end: number } {
  if (total <= max) return { start: 0, end: Math.max(total, 0) };
  const start = Math.min(Math.max(index - Math.floor(max / 2), 0), total - max);
  return { start, end: start + max };
}

/** A sideways swipe this long (px), or this fast (px/s), moves to the neighbour. */
export const SWIPE_DISTANCE = 60;
export const SWIPE_VELOCITY = 400;

/** -1 = the previous notice, 1 = the next one, 0 = stay. A swipe to the left shows the next. */
export function swipeStep(offsetX: number, velocityX: number): -1 | 0 | 1 {
  if (offsetX <= -SWIPE_DISTANCE || velocityX <= -SWIPE_VELOCITY) return 1;
  if (offsetX >= SWIPE_DISTANCE || velocityX >= SWIPE_VELOCITY) return -1;
  return 0;
}
