/**
 * What a file of a message really is, from its first bytes: the browser's
 * type is a claim, the bytes decide. Pure, so the server route and its tests
 * share it.
 */

export type SniffedType = "jpeg" | "png" | "gif" | "webp" | "pdf" | "zip" | "ole" | "text";

/** How many bytes from the start are enough to tell. */
export const SNIFF_BYTES = 512;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export function sniffFileType(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "webp";
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  if (bytes.length > 0 && !bytes.includes(0)) return "text";
  return null;
}

const EXPECTED: Record<string, SniffedType> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/zip": "zip",
  // The Office Open XML and OpenDocument files are zip archives.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "zip",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "zip",
  "application/vnd.oasis.opendocument.text": "zip",
  "application/vnd.oasis.opendocument.spreadsheet": "zip",
  "application/vnd.oasis.opendocument.presentation": "zip",
  // The old Office files are OLE compound documents.
  "application/msword": "ole",
  "application/vnd.ms-excel": "ole",
  "application/vnd.ms-powerpoint": "ole",
  "text/plain": "text",
  "text/csv": "text",
};

/** Whether the bytes are what the declared type says. */
export function contentMatchesType(mime: string, bytes: Uint8Array): boolean {
  const expected = EXPECTED[mime];
  return expected !== undefined && sniffFileType(bytes) === expected;
}
