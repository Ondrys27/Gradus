import "server-only";

/** The private bucket of the files of Messages: <space>/<message>/<file>. */
export const CHAT_BUCKET = "chat-attachments";
/** Where a file not opened for a year waits; clients never read under it. */
export const CHAT_TRASH_PREFIX = "trash/";
/** How long a link to a file lives. */
export const CHAT_SIGNED_URL_SECONDS = 60;

export function trashPath(path: string): string {
  return `${CHAT_TRASH_PREFIX}${path}`;
}
