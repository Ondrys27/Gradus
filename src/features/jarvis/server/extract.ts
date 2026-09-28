import { unzipSync } from "fflate";
import type { FileKind } from "../files";

/**
 * Text out of the files the model cannot read by itself: PDF, DOCX and XLSX
 * are turned into plain text here; TXT and CSV are decoded. Images are not
 * handled here, they go to the model as they are (server/images.ts).
 */

/** About 15 000 tokens per file; a longer file is cut and the model is told so. */
export const MAX_EXTRACTED_CHARS = 60_000;
/** Largest unpacked part of a DOCX or XLSX that is read; guards against ZIP bombs. */
const MAX_UNPACKED_PART = 40 * 1024 * 1024;

export type Extracted = { text: string; truncated: boolean };

export class UnreadableFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableFileError";
  }
}

function limit(text: string): Extracted {
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (clean.length <= MAX_EXTRACTED_CHARS) return { text: clean, truncated: false };
  return { text: clean.slice(0, MAX_EXTRACTED_CHARS), truncated: true };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Unpacks only the wanted parts of an Office file. */
function readParts(bytes: Uint8Array, wanted: (name: string) => boolean): Map<string, string> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => wanted(file.name) && file.originalSize <= MAX_UNPACKED_PART,
    });
  } catch (error) {
    throw new UnreadableFileError(`zip: ${(error as Error).message}`);
  }
  const decoder = new TextDecoder();
  return new Map(Object.entries(files).map(([name, data]) => [name, decoder.decode(data)]));
}

// ---------------------------------------------------------------------------

export function docxText(bytes: Uint8Array): Extracted {
  const xml = readParts(bytes, (name) => name === "word/document.xml").get("word/document.xml");
  if (xml === undefined) throw new UnreadableFileError("docx: no document part");
  const text = xml
    // Field codes and deleted revisions are not part of the visible text.
    .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, "")
    .replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, "")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:(br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<[^>]+>/g, "");
  return limit(decodeXml(text));
}

// ---------------------------------------------------------------------------

/** "BC12" → 54 (zero-based column). */
export function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? "";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function textRuns(xml: string): string {
  const runs = [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => match[1]);
  return decodeXml(runs.join(""));
}

function attribute(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

/** Sheets in workbook order with the path of their part. */
function sheetParts(parts: Map<string, string>): { name: string; path: string }[] {
  const workbook = parts.get("xl/workbook.xml") ?? "";
  const rels = parts.get("xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attribute(match[0], "Id");
    const target = attribute(match[0], "Target");
    if (id && target) {
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      targets.set(id, path);
    }
  }
  const sheets: { name: string; path: string }[] = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml(attribute(match[0], "name") ?? "");
    const id = attribute(match[0], "r:id");
    const path = id ? targets.get(id) : undefined;
    if (path) sheets.push({ name, path });
  }
  if (sheets.length) return sheets;
  // Without relationships fall back to the sheet parts in number order.
  return [...parts.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]))
    .map((path, index) => ({ name: `Sheet${index + 1}`, path }));
}

/** Each sheet as tab-separated rows under its name. */
export function xlsxText(bytes: Uint8Array): Extracted {
  const parts = readParts(
    bytes,
    (name) =>
      name === "xl/workbook.xml" ||
      name === "xl/_rels/workbook.xml.rels" ||
      name === "xl/sharedStrings.xml" ||
      /^xl\/worksheets\/[^/]+\.xml$/.test(name),
  );
  if (!parts.has("xl/workbook.xml")) throw new UnreadableFileError("xlsx: no workbook part");

  const shared = [
    ...(parts.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map((match) => textRuns(match[1]));

  const out: string[] = [];
  let length = 0;
  for (const sheet of sheetParts(parts)) {
    const xml = parts.get(sheet.path);
    if (xml === undefined) continue;
    out.push(`# ${sheet.name}`);
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1];
        const body = cell[2] ?? "";
        const type = attribute(attrs, "t");
        const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let text = "";
        if (type === "s") text = shared[Number(value)] ?? "";
        else if (type === "inlineStr") text = textRuns(body);
        else if (type === "b") text = value === "1" ? "TRUE" : "FALSE";
        else if (value !== undefined) text = decodeXml(value);
        const reference = attribute(attrs, "r");
        const index = reference ? columnIndex(reference) : cells.length;
        if (index < 0 || index > 16_383) continue;
        while (cells.length < index) cells.push("");
        cells[index] = text.replace(/[\t\n\r]+/g, " ").trim();
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (!cells.length) continue;
      const line = cells.join("\t");
      out.push(line);
      length += line.length + 1;
      if (length > MAX_EXTRACTED_CHARS) break;
    }
    out.push("");
    if (length > MAX_EXTRACTED_CHARS) break;
  }
  return limit(out.join("\n"));
}

// ---------------------------------------------------------------------------

export async function pdfText(bytes: Uint8Array): Promise<Extracted> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    // pdf.js takes ownership of the buffer; give it a copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    return limit(text.map((page) => page.trim()).join("\n\n"));
  } catch (error) {
    throw new UnreadableFileError(`pdf: ${(error as Error).message}`);
  }
}

export function plainText(bytes: Uint8Array): Extracted {
  return limit(new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, ""));
}

/** The text a document carries; null for images. */
export async function extractText(kind: FileKind, bytes: Uint8Array): Promise<Extracted | null> {
  switch (kind) {
    case "pdf":
      return pdfText(bytes);
    case "docx":
      return docxText(bytes);
    case "xlsx":
      return xlsxText(bytes);
    case "txt":
    case "csv":
      return plainText(bytes);
    default:
      return null;
  }
}
