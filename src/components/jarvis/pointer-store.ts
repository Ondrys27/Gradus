type Listener = (x: number, y: number) => void;

const listeners = new Set<Listener>();
let frame = 0;
let lastX = 0;
let lastY = 0;

function flush() {
  frame = 0;
  for (const listener of listeners) listener(lastX, lastY);
}

function onMove(event: PointerEvent) {
  // Touch has no hover; eyes following a finger mid-scroll looks wrong.
  if (event.pointerType === "touch") return;
  lastX = event.clientX;
  lastY = event.clientY;
  if (!frame) frame = requestAnimationFrame(flush);
}

/**
 * One shared, passive pointer listener for every Jarvis on the page, delivered at
 * most once per frame. Returns the unsubscribe function.
 */
export function subscribePointer(listener: Listener): () => void {
  if (listeners.size === 0) window.addEventListener("pointermove", onMove, { passive: true });
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}
