"use client";

import { useState } from "react";
import { resolveCurrent, stepIndex } from "./notice-queue";

type Tracked = { key: string; ids: string[]; currentId: string | null; direction: 1 | -1 };

/**
 * The card's place in a queue of notices: which one is on screen and the
 * way the last change went (for the slide). The items come from outside;
 * whatever leaves them (closed, done) hands its place to the next one, and
 * skipping only moves the card, nothing leaves the queue.
 */
export function useNoticeQueue<T extends { id: string }>(items: readonly T[]) {
  const ids = items.map((item) => item.id);
  const key = ids.join(",");
  const [tracked, setTracked] = useState<Tracked>(() => ({
    key,
    ids,
    currentId: ids[0] ?? null,
    direction: 1,
  }));

  // The queue changed: follow it during render, so the old card never flashes.
  let { currentId, direction } = tracked;
  if (tracked.key !== key) {
    const next = resolveCurrent(tracked.ids, tracked.currentId, ids);
    if (next !== currentId) direction = 1;
    currentId = next;
    setTracked({ key, ids, currentId, direction });
  }

  const found = currentId ? ids.indexOf(currentId) : -1;
  const index = found < 0 ? 0 : found;
  const total = ids.length;

  const step = (delta: 1 | -1) => {
    if (total < 2) return;
    setTracked({ key, ids, currentId: ids[stepIndex(index, delta, total)]!, direction: delta });
  };

  return {
    current: items[index] ?? null,
    index,
    total,
    direction,
    next: () => step(1),
    previous: () => step(-1),
  };
}
