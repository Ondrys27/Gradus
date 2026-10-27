"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { InvoiceDocument } from "./model";
import { FONT_FILES, FONT_URL_BASE, PAGE, PRINT } from "./palette";
import type { DocStyle, Primitives } from "./primitives";
import { InvoiceTemplate } from "./template";

/**
 * The live preview: the same template as the PDF, drawn with DOM elements.
 * Every block is a flex column with border-box sizing like react-pdf's
 * layout, one point is one CSS pixel, and the page is zoomed to fit its box.
 */

const FONT_FACES = FONT_FILES.map(
  (font) =>
    `@font-face{font-family:${font.family};src:url("${FONT_URL_BASE}/${font.file}") format("truetype");font-weight:${font.weight};font-style:normal;font-display:swap}`,
).join("");

const css = (style?: DocStyle) => (style ?? {}) as CSSProperties;

const BLOCK: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  boxSizing: "border-box",
  position: "relative",
  minWidth: 0,
};

const HTML_PRIMITIVES: Primitives = {
  Page: ({ style, children }) => (
    <div style={{ ...BLOCK, width: PAGE.width, minHeight: PAGE.height, ...css(style) }}>{children}</div>
  ),
  View: ({ style, children }) => <div style={{ ...BLOCK, ...css(style) }}>{children}</div>,
  Text: ({ style, render, children }) => (
    <div
      style={{
        display: "block",
        boxSizing: "border-box",
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        minWidth: 0,
        ...css(style),
      }}
    >
      {render ? render({ pageNumber: 1, totalPages: 1 }) : (children as ReactNode)}
    </div>
  ),
  Svg: ({ width, height, viewBox, children }) => (
    <svg width={width} height={height} viewBox={viewBox} aria-hidden shapeRendering="crispEdges">
      {children}
    </svg>
  ),
  Path: ({ d, fill }) => <path d={d} fill={fill} />,
};

/** The invoice page, zoomed to the width of its box. */
export function InvoicePaper({
  doc,
  className,
  label,
}: {
  doc: InvoiceDocument;
  className?: string;
  /** Accessible name of the picture, e.g. "Preview of the invoice". */
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const update = () => {
      const width = node.clientWidth;
      // A hidden box (another tab) measures 0; keep the last real size.
      if (width > 0) setZoom(width / PAGE.width);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={box}
      role="img"
      aria-label={label}
      className={cn("w-full overflow-hidden rounded-md shadow-lg", className)}
      style={{ backgroundColor: PRINT.paper, aspectRatio: zoom ? undefined : `${PAGE.width} / ${PAGE.height}` }}
    >
      <style>{FONT_FACES}</style>
      {zoom > 0 && (
        <div style={{ zoom, width: PAGE.width }} aria-hidden>
          <InvoiceTemplate doc={doc} P={HTML_PRIMITIVES} />
        </div>
      )}
    </div>
  );
}
