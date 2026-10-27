import type { ReactNode } from "react";

/**
 * The building blocks a template is written with. The server passes the
 * components of @react-pdf/renderer, the preview passes plain DOM ones
 * (html.tsx), so one template draws both the PDF and its preview. Styles are
 * the subset both understand: flexbox, sizes in points (pixels on screen),
 * explicit border widths, colours and styles.
 */
export type DocStyle = Record<string, string | number | undefined>;

export type PageInfo = { pageNumber: number; totalPages: number };

export type Primitives = {
  Page: (props: { style?: DocStyle; children?: ReactNode }) => ReactNode;
  View: (props: {
    style?: DocStyle;
    /** Repeated on every page (the footer). */
    fixed?: boolean;
    /** False keeps the block on one page. */
    wrap?: boolean;
    children?: ReactNode;
  }) => ReactNode;
  Text: (props: {
    style?: DocStyle;
    fixed?: boolean;
    render?: (info: PageInfo) => string;
    children?: ReactNode;
  }) => ReactNode;
  Svg: (props: { width: number; height: number; viewBox: string; children?: ReactNode }) => ReactNode;
  Path: (props: { d: string; fill: string }) => ReactNode;
};
