/**
 * Runs `task` once the main thread is free (or after a short fallback delay
 * where requestIdleCallback is missing, e.g. Safari). Returns a cancel function,
 * so it can be returned straight from an effect. Used to prefetch code that is
 * split out of the first load but likely needed soon.
 */
export function whenIdle(task: () => unknown, timeout = 4000): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => void task(), { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(() => void task(), Math.min(timeout, 2000));
  return () => window.clearTimeout(id);
}
