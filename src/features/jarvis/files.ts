/**
 * Files in the Jarvis chat: what may be attached, shared by the panel and the
 * server. The server tells the real type from the content (server/file-type.ts).
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 3;

export const FILE_KINDS = ["pdf", "png", "jpeg", "txt", "csv", "docx", "xlsx"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const MIME_BY_KIND: Record<FileKind, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  txt: "text/plain",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  pdf: "pdf",
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  txt: "txt",
  csv: "csv",
  docx: "docx",
  xlsx: "xlsx",
};

/** For the file picker. */
export const ACCEPTED_EXTENSIONS = Object.keys(KIND_BY_EXTENSION).map((ext) => `.${ext}`);

export function isImageKind(kind: FileKind): kind is "png" | "jpeg" {
  return kind === "png" || kind === "jpeg";
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * The type the browser sends with the upload (the bucket accepts only the
 * listed ones). It says nothing about the content; the server checks that.
 */
export function uploadContentType(name: string): string | null {
  const kind = KIND_BY_EXTENSION[extensionOf(name)];
  return kind ? MIME_BY_KIND[kind] : null;
}

/** A readable file name, without folders or control characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001F\u007F<>"]/g, "").trim();
  return clean.slice(0, 120) || "file";
}
