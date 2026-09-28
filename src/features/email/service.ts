import "server-only";
import { MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE } from "@/features/jarvis/files";
import { detectFileKind } from "@/features/jarvis/server/file-type";
import { escapeHtml, type EmailAttachment } from "@/lib/email/resend";
import { EmailError } from "./errors";

/**
 * Sending an e-mail's attachments: the same bucket as Jarvis's files, under
 * the sender's own `<user id>/email/<uuid>` folder (storage RLS already
 * restricts the bucket to each user's own top folder). Nothing is kept after
 * the e-mail is sent; there is no mailbox to browse later.
 */
export const ATTACHMENTS_BUCKET = "attachments";
export const MAX_EMAIL_ATTACHMENTS = MAX_FILES_PER_MESSAGE;

export function isOwnEmailUploadPath(path: string, userId: string): boolean {
  return new RegExp(
    `^${userId}/email/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
  ).test(path);
}

/**
 * Turns one downloaded file into a Resend attachment, refusing anything over
 * the size limit or whose content is not one of the allowed types (the name
 * says nothing on its own).
 */
export function prepareAttachment(bytes: Uint8Array, name: string): EmailAttachment {
  if (bytes.length > MAX_FILE_BYTES) throw new EmailError("fileTooLarge", name);
  if (!detectFileKind(bytes, name)) throw new EmailError("fileType", name);
  return { filename: name, content: Buffer.from(bytes).toString("base64") };
}

/** The body as simple HTML: escaped, with line breaks kept. */
export function bodyToHtml(body: string): string {
  return `<p style="white-space:pre-wrap">${escapeHtml(body)}</p>`;
}
