/**
 * The four invoice styles on a made-up invoice, as PDFs and PNG pictures in
 * docs/invoices: `bun scripts/invoice-samples.ts`. The PNGs come from macOS
 * `sips`; elsewhere only the PDFs are written.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import cs from "../src/locales/cs.json";
import { buildInvoiceDocument } from "../src/features/invoices/document/model";
import { renderInvoicePdf } from "../src/features/invoices/document/pdf-render";
import { sampleInvoice } from "../src/features/invoices/document/sample";
import { INVOICE_STYLES } from "../src/features/invoices/types";
import { DEFAULT_FORMAT_SETTINGS } from "../src/lib/format";

const OUT = path.resolve(__dirname, "../docs/invoices");
mkdirSync(OUT, { recursive: true });

const t = createTranslator({ locale: "cs", messages: cs, namespace: "invoices.document" });

for (const style of INVOICE_STYLES) {
  for (const vatPayer of [false, true]) {
    const input = sampleInvoice(style, { vatPayer });
    const doc = buildInvoiceDocument(input, (key, values) => t(key as never, values as never), DEFAULT_FORMAT_SETTINGS);
    const bytes = await renderInvoicePdf(doc);
    const name = vatPayer ? `${style}-vat` : style;
    const pdf = path.join(OUT, `${name}.pdf`);
    writeFileSync(pdf, bytes);
    if (process.platform === "darwin") {
      execFileSync("sips", ["-s", "format", "png", "-Z", "1400", pdf, "--out", path.join(OUT, `${name}.png`)], {
        stdio: "ignore",
      });
    }
    console.log(`docs/invoices/${name}.pdf`);
  }
}
