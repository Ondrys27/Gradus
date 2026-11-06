/**
 * A PNG of a whole mind map, not just the part on screen: the map's canvas
 * (every visible node and edge at 100 %) drawn into an image in the browser;
 * nothing leaves it. Kept within the size browsers can still draw.
 */

/** Elements with this attribute stay out of the picture. */
export const CAPTURE_SKIP_ATTRIBUTE = "data-map-capture-skip";

/** Pixels of the image at most (Safari draws about 16.7 million). */
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 16_000;
/** Nodes glide in when the map first appears; the picture waits for them. */
const SETTLE_MS = 900;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** The canvas of the map inside `container`, once it is on screen (up to `timeout` ms). */
async function findCanvas(container: HTMLElement, timeout = 5000): Promise<HTMLElement | null> {
  const started = performance.now();
  for (;;) {
    const canvas = container.querySelector<HTMLElement>("[data-map-canvas]");
    if (canvas && canvas.offsetWidth > 0) return canvas;
    if (performance.now() - started > timeout) return null;
    await wait(100);
  }
}

export async function captureMindMap(
  container: HTMLElement,
  { justShown = false, reduceMotion = false } = {},
): Promise<Blob> {
  const canvas = await findCanvas(container);
  if (!canvas) throw new Error("mind map not on screen");
  if (justShown && !reduceMotion) await wait(SETTLE_MS);
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight;
  const pixelRatio = Math.max(
    0.25,
    Math.min(2, Math.sqrt(MAX_PIXELS / (width * height)), MAX_SIDE / Math.max(width, height)),
  );
  const { toBlob } = await import("html-to-image");
  const blob = await toBlob(canvas, {
    width,
    height,
    pixelRatio,
    cacheBust: false,
    skipFonts: true,
    // The theme's canvas colour, so the picture looks like the map in the app.
    backgroundColor:
      getComputedStyle(document.documentElement).getPropertyValue("--color-canvas").trim() ||
      undefined,
    // The selection ring is a moment of the app, not part of the map.
    filter: (element) =>
      !(element instanceof HTMLElement && element.hasAttribute(CAPTURE_SKIP_ATTRIBUTE)),
    // The canvas sits inside the zoomed and panned layer; the picture is at 100 %.
    style: { transform: "none", margin: "0" },
  });
  if (!blob) throw new Error("mind map image failed");
  return blob;
}
