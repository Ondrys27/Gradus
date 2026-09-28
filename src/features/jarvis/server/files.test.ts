// @vitest-environment node
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { cleanFileName, uploadContentType } from "../files";
import {
  columnIndex,
  decodeXml,
  docxText,
  extractText,
  MAX_EXTRACTED_CHARS,
  xlsxText,
} from "./extract";
import { detectFileKind } from "./file-type";

const CONTENT_TYPES = strToU8(`<?xml version="1.0"?><Types/>`);

function docx(body: string) {
  return zipSync({
    "[Content_Types].xml": CONTENT_TYPES,
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`,
    ),
  });
}

function xlsx() {
  return zipSync({
    "[Content_Types].xml": CONTENT_TYPES,
    "xl/workbook.xml": strToU8(
      `<workbook><sheets><sheet name="Leads &amp; deals" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    "xl/sharedStrings.xml": strToU8(
      `<sst><si><t>Company</t></si><si><r><t>Val</t></r><r><t>ue</t></r></si><si><t>Acme</t></si></sst>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="b"><v>1</v></c><c r="C2"><v>1500.5</v></c></row>
        <row r="3"><c r="A3" t="inlineStr"><is><t>Inline</t></is></c></row>
      </sheetData></worksheet>`,
    ),
  });
}

/** A one-page PDF with the given text, with a correct cross-reference table. */
function pdf(text: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return strToU8(out);
}

describe("detectFileKind", () => {
  it("tells the type from the content, not the name", () => {
    expect(detectFileKind(pdf("Hi"), "notes.txt")).toBe("pdf");
    expect(
      detectFileKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0]), "a.jpg"),
    ).toBe("png");
    expect(detectFileKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]), "a.png")).toBe("jpeg");
    expect(detectFileKind(docx("<w:p><w:r><w:t>x</w:t></w:r></w:p>"), "a.xlsx")).toBe("docx");
    expect(detectFileKind(xlsx(), "a.docx")).toBe("xlsx");
    expect(detectFileKind(strToU8("name,phone\nAcme,123"), "list.csv")).toBe("csv");
    expect(detectFileKind(strToU8("Příliš žluťoučký kůň"), "notes.pdf")).toBe("txt");
  });

  it("refuses everything else", () => {
    // An executable renamed to .pdf, a plain ZIP, binary data and an empty file.
    expect(detectFileKind(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0]), "invoice.pdf")).toBeNull();
    expect(detectFileKind(zipSync({ "a.txt": strToU8("x") }), "a.docx")).toBeNull();
    expect(detectFileKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), "a.xlsx")).toBeNull();
    expect(
      detectFileKind(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]), "a.png"),
    ).toBeNull();
    expect(detectFileKind(new Uint8Array([0x68, 0x00, 0x69]), "a.txt")).toBeNull();
    expect(detectFileKind(new Uint8Array([0xc3, 0x28]), "a.txt")).toBeNull();
    expect(detectFileKind(new Uint8Array(), "a.txt")).toBeNull();
  });
});

describe("text extraction", () => {
  it("reads paragraphs, tabs and entities of a DOCX and skips field codes", () => {
    const file = docx(
      `<w:p><w:r><w:t>Offer for</w:t></w:r><w:r><w:t xml:space="preserve"> Acme &amp; Co</w:t></w:r></w:p>` +
        `<w:p><w:r><w:instrText>PAGE</w:instrText><w:t>Price</w:t><w:tab/><w:t>12 000</w:t></w:r></w:p>`,
    );
    expect(docxText(file)).toEqual({
      text: "Offer for Acme & Co\nPrice\t12 000",
      truncated: false,
    });
  });

  it("reads every sheet of an XLSX as rows with their columns", () => {
    expect(xlsxText(xlsx()).text).toBe(
      "# Leads & deals\nCompany\t\tValue\nAcme\tTRUE\t1500.5\nInline",
    );
  });

  it("reads the text of a PDF", async () => {
    const result = await extractText("pdf", pdf("Quarterly plan"));
    expect(result?.text).toContain("Quarterly plan");
  });

  it("cuts very long text and says so", async () => {
    const long = strToU8("a".repeat(MAX_EXTRACTED_CHARS + 10));
    expect(await extractText("txt", long)).toMatchObject({ truncated: true });
    expect(await extractText("png", long)).toBeNull();
  });

  it("decodes XML entities and column letters", () => {
    expect(decodeXml("&lt;b&gt; &#382; &#x10D; &unknown;")).toBe("<b> ž č &unknown;");
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AB3")).toBe(27);
  });
});

describe("file names", () => {
  it("maps names to an allowed upload type and cleans them", () => {
    expect(uploadContentType("Report.PDF")).toBe("application/pdf");
    expect(uploadContentType("photo.jpg")).toBe("image/jpeg");
    expect(uploadContentType("virus.exe")).toBeNull();
    expect(cleanFileName("../../etc/<passwd>")).toBe("passwd");
    expect(cleanFileName("")).toBe("file");
  });
});
