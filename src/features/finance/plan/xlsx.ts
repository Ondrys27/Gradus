import { strToU8, zipSync } from "fflate";
import { columnName, type Grid, type GridStyle } from "./layout";

/**
 * A minimal XLSX (Office Open XML) workbook with one sheet, written in the
 * browser without a spreadsheet library: inline strings, formulas with their
 * computed values cached (so previews show numbers before Excel recalculates),
 * Arial throughout, typed-in numbers blue, formulas black, totals bold,
 * negative numbers red, the first column and the header row frozen.
 */

const STYLE_INDEX: Record<GridStyle, [number, number]> = {
  // [whole numbers, with cents]
  text: [0, 0],
  header: [1, 1],
  heading: [1, 1],
  input: [2, 5],
  computed: [3, 6],
  total: [4, 7],
  legend: [8, 8],
};

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0;[Red]\\-#,##0"/><numFmt numFmtId="165" formatCode="#,##0.00;[Red]\\-#,##0.00"/></numFmts>
<fonts count="4">
<font><sz val="10"/><color rgb="FF000000"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/><family val="2"/></font>
<font><sz val="10"/><color rgb="FF0000FF"/><name val="Arial"/><family val="2"/></font>
<font><i/><sz val="9"/><color rgb="FF666666"/><name val="Arial"/><family val="2"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF999999"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Excel's rules for a sheet name: at most 31 characters, none of []:*?/\. */
export function sheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet1";
}

function sheetXml(grid: Grid): string {
  const decimals = grid.decimals ? 1 : 0;
  const rows = grid.cells
    .map((line, rowIndex) => {
      const cells = line
        .map((cell, columnIndex) => {
          if (!cell || (cell.v === null && !cell.f)) return "";
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          const style = STYLE_INDEX[cell.style][decimals];
          const formula = cell.f ? `<f>${escapeXml(cell.f)}</f>` : "";
          if (typeof cell.v === "number") {
            return `<c r="${ref}" s="${style}">${formula}<v>${cell.v}</v></c>`;
          }
          if (cell.f) {
            return `<c r="${ref}" s="${style}" t="str">${formula}<v>${escapeXml(cell.v ?? "")}</v></c>`;
          }
          return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.v ?? "")}</t></is></c>`;
        })
        .join("");
      return cells ? `<row r="${rowIndex + 1}">${cells}</row>` : "";
    })
    .join("");
  const columns = grid.widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="14"/>
<cols>${columns}</cols>
<sheetData>${rows}</sheetData>
</worksheet>`;
}

/** The workbook as bytes, ready for a Blob. */
export function gridToXlsx(grid: Grid, name: string): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName(name))}" sheetId="1" r:id="rId1"/></sheets>
<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": strToU8(STYLES),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(grid)),
  };
  return zipSync(files, { level: 6 });
}
