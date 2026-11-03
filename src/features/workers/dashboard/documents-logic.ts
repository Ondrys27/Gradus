import {
  WORKER_DOCUMENT_MAX_BYTES,
  WORKER_DOCUMENT_MIMES,
  type WorkerDocumentMime,
} from "../permissions-catalog";

/** Checks of a person's document before it is uploaded (the bucket and the table check again). */

export const DOCUMENT_NAME_MAX = 200;

export type DocumentError = "tooLarge" | "wrongType" | "uploadFailed" | "readOnly" | "saveFailed";

const EXTENSION_MIMES: Record<string, WorkerDocumentMime> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  txt: "text/plain",
  csv: "text/csv",
};

/** The allowed type of a file: what the browser says, else by its extension; null when not allowed. */
export function documentMime(file: { name: string; type: string }): WorkerDocumentMime | null {
  const declared = file.type.toLowerCase();
  if ((WORKER_DOCUMENT_MIMES as readonly string[]).includes(declared)) {
    return declared as WorkerDocumentMime;
  }
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_MIMES[extension] ?? null;
}

export type DocumentKind = "pdf" | "image" | "office" | "text";

export function documentKind(mime: string): DocumentKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "text";
  return "office";
}

/** A file name as stored: trimmed, at most 200 characters, never empty. */
export function documentName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return (trimmed || "document").slice(0, DOCUMENT_NAME_MAX).trim();
}

/** Why a file can not be added, checked before anything is uploaded. */
export function checkDocument(file: {
  name: string;
  type: string;
  size: number;
}): DocumentError | null {
  if (file.size <= 0 || file.size > WORKER_DOCUMENT_MAX_BYTES) return "tooLarge";
  if (!documentMime(file)) return "wrongType";
  return null;
}
