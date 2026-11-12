import { unzipSync } from "fflate";
import { extensionOf, type FileKind } from "../files";

/**
 * The real type of an uploaded file, told from its content. The name only
 * picks between CSV and plain text, which look the same inside.
 */

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // PK\3\4

/** Which Office package a ZIP is, by the parts inside; null for any other ZIP. */
function officeKind(bytes: Uint8Array): "docx" | "xlsx" | null {
  const names = new Set<string>();
  try {
    // Only the names are read; nothing is decompressed.
    unzipSync(bytes, {
      filter: (file) => {
        names.add(file.name);
        return false;
      },
    });
  } catch {
    return null;
  }
  if (!names.has("[Content_Types].xml")) return null;
  if (names.has("word/document.xml")) return "docx";
  if (names.has("xl/workbook.xml")) return "xlsx";
  return null;
}

/** Text is valid UTF-8 without NUL bytes or other binary control characters. */
function isText(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  // Tab, line feed, carriage return and form feed are fine; other C0 controls mean binary.
  return !/[\u0000-\u0008\u000B\u000E-\u001F]/.test(text);
}

/**
 * The file's real type from its first bytes (and, for ZIP, its parts).
 * Null when it is none of the allowed types, whatever its name says.
 */
export function detectFileKind(bytes: Uint8Array, name: string): FileKind | null {
  if (bytes.length === 0) return null;
  if (startsWith(bytes, PDF)) return "pdf";
  if (startsWith(bytes, PNG)) return "png";
  if (startsWith(bytes, JPEG)) return "jpeg";
  if (startsWith(bytes, ZIP)) return officeKind(bytes);
  if (isText(bytes)) return extensionOf(name) === "csv" ? "csv" : "txt";
  return null;
}
