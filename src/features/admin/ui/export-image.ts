/**
 * Saving a chart as an image in the browser. The chart's colours are theme
 * tokens (CSS variables), which an SVG loaded as an image can not resolve, so
 * every element gets its computed paint inlined before it is drawn.
 */

const PAINT = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
] as const;

function inlinePaint(source: Element, target: Element) {
  const style = window.getComputedStyle(source);
  const declarations = PAINT.map((name) => `${name}:${style.getPropertyValue(name)}`).join(";");
  target.setAttribute("style", declarations);
  const sourceChildren = source.children;
  const targetChildren = target.children;
  for (let i = 0; i < sourceChildren.length; i++) {
    if (targetChildren[i]) inlinePaint(sourceChildren[i], targetChildren[i]);
  }
}

/** The chart drawn at twice its size on the card's background. */
export async function svgToPngBlob(svg: SVGSVGElement, backdrop: Element): Promise<Blob> {
  const { width, height } = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlinePaint(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const markup = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();

    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    // The nearest painted background behind the chart (the card).
    let element: Element | null = backdrop;
    let background = "";
    while (element) {
      const color = window.getComputedStyle(element).backgroundColor;
      if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) {
        background = color;
        break;
      }
      element = element.parentElement;
    }
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No image"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
