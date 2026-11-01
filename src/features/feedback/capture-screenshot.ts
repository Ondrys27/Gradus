import { REPORT_SCREENSHOT_MAX_BYTES } from "./report";

/** Elements marked with this attribute (the dialogs) stay out of the picture. */
export const CAPTURE_IGNORE_ATTRIBUTE = "data-capture-ignore";

function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((base64.length * 3) / 4);
}

/**
 * The visible part of the page as a JPEG data URL (the library draws the DOM
 * into a canvas; nothing leaves the browser). The report dialog itself is left
 * out. Tries lower quality and size until it fits the limit; throws when the
 * browser can not draw the page.
 */
export async function captureScreenshot(): Promise<string> {
  const { toJpeg } = await import("html-to-image");
  const width = window.innerWidth;
  const height = window.innerHeight;
  const attempts = [
    { quality: 0.8, pixelRatio: 1 },
    { quality: 0.6, pixelRatio: 0.75 },
    { quality: 0.5, pixelRatio: 0.5 },
  ];
  for (const attempt of attempts) {
    const dataUrl = await toJpeg(document.body, {
      ...attempt,
      width,
      height,
      cacheBust: false,
      skipFonts: true,
      backgroundColor: getComputedStyle(document.body).backgroundColor || undefined,
      style: {
        transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
        transformOrigin: "top left",
      },
      filter: (node) =>
        !(node instanceof HTMLElement && node.hasAttribute(CAPTURE_IGNORE_ATTRIBUTE)),
    });
    // 4 bytes of margin for the base64 padding.
    if (dataUrlBytes(dataUrl) <= REPORT_SCREENSHOT_MAX_BYTES - 4) return dataUrl;
  }
  throw new Error("screenshot too large");
}
