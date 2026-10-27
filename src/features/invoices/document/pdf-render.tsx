import path from "node:path";
import { Document, Font, Page, Path, Svg, Text, View, renderToBuffer, type Styles } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { InvoiceDocument } from "./model";
import { FONT_FILES } from "./palette";
import type { DocStyle, Primitives } from "./primitives";
import { InvoiceTemplate } from "./template";

/**
 * The invoice as a PDF, drawn on the server (through server/pdf.ts; the
 * sample script imports this file directly) by @react-pdf/renderer (no
 * browser, fits a Vercel Hobby function). The fonts are the bundled TTF files
 * with the full Czech alphabet; nothing on the page names the app.
 */

const FONT_DIR = path.join(process.cwd(), "public", "fonts", "invoice");
let registered = false;

function registerFonts() {
  if (registered) return;
  const families = new Map<string, { src: string; fontWeight: number }[]>();
  for (const font of FONT_FILES) {
    const list = families.get(font.family) ?? [];
    list.push({ src: path.join(FONT_DIR, font.file), fontWeight: font.weight });
    families.set(font.family, list);
  }
  for (const [family, fonts] of families) Font.register({ family, fonts });
  // Names and addresses are never split with a hyphen.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

/** The shared style subset is valid react-pdf style; only the index signature differs. */
const pdfStyle = (style: DocStyle | undefined) => style as Styles[string] | undefined;

const PDF_PRIMITIVES: Primitives = {
  Page: ({ style, children }) => (
    <Page size="A4" style={pdfStyle(style)}>
      {children}
    </Page>
  ),
  // Only the props that are set: react-pdf treats a Text with a `render` key as dynamic.
  View: ({ style, fixed, wrap, children }) => (
    <View style={pdfStyle(style)} {...(fixed ? { fixed } : {})} {...(wrap === false ? { wrap } : {})}>
      {children}
    </View>
  ),
  Text: ({ style, fixed, render, children }) => (
    <Text style={pdfStyle(style)} {...(fixed ? { fixed } : {})} {...(render ? { render } : {})}>
      {children as ReactNode}
    </Text>
  ),
  Svg: ({ width, height, viewBox, children }) => (
    <Svg width={width} height={height} viewBox={viewBox}>
      {children}
    </Svg>
  ),
  Path: ({ d, fill }) => <Path d={d} fill={fill} />,
};

export async function renderInvoicePdf(doc: InvoiceDocument): Promise<Uint8Array> {
  registerFonts();
  const buffer = await renderToBuffer(
    <Document
      title={doc.fileTitle}
      author={doc.author}
      creator={doc.author}
      producer={doc.author}
      language={undefined}
    >
      <InvoiceTemplate doc={doc} P={PDF_PRIMITIVES} />
    </Document>,
  );
  return new Uint8Array(buffer);
}
