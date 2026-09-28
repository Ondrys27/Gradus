import type Anthropic from "@anthropic-ai/sdk";
import type { FileKind } from "./files";

/** A file on a stored message as the model gets it. */
export type HistoryAttachment = {
  name: string;
  kind: FileKind;
  /** Text taken out of a document; null for images. */
  text: string | null;
  truncated?: boolean;
  /** Only on the message being sent now: images are shown to the model once. */
  image?: { mediaType: "image/png" | "image/jpeg"; data: string };
};

export type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: HistoryAttachment[];
};

/** Earlier messages keep only the start of their documents, so the history stays affordable. */
export const EARLIER_FILE_CHARS = 4000;

function attributeValue(value: string): string {
  return value.replace(/[&"<>]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function fileBlocks(file: HistoryAttachment, latest: boolean): Anthropic.ContentBlockParam[] {
  const name = attributeValue(file.name);
  if (file.text === null) {
    if (file.image) {
      return [
        { type: "text", text: `<image name="${name}"/>` },
        {
          type: "image",
          source: { type: "base64", media_type: file.image.mediaType, data: file.image.data },
        },
      ];
    }
    return [
      {
        type: "text",
        text: `<image name="${name}">Shared earlier in the conversation; it is no longer visible.</image>`,
      },
    ];
  }
  const cut = !latest && file.text.length > EARLIER_FILE_CHARS;
  const text = cut ? file.text.slice(0, EARLIER_FILE_CHARS) : file.text;
  const note = cut
    ? "\n[Only the beginning is repeated here; the full file was read earlier in the conversation.]"
    : file.truncated
      ? "\n[The file is longer; only its beginning could be read. Tell the user if that matters.]"
      : "";
  return [
    {
      type: "text",
      text: `<file name="${name}" type="${file.kind}">\n${text || "(no readable text)"}${note}\n</file>`,
    },
  ];
}

function userContent(row: StoredMessage, latest: boolean): Anthropic.MessageParam["content"] {
  const files = row.attachments ?? [];
  if (!files.length) return row.content;
  const blocks = files.flatMap((file) => fileBlocks(file, latest));
  // Documents go before the question, as the model reads them best that way.
  if (row.content.trim()) blocks.push({ type: "text", text: row.content });
  return blocks;
}

/**
 * History for the model: oldest first and starting with the user, as the API
 * requires. A turn left without an answer (a failed call) sits next to the
 * following user message, which the API reads as one turn. Files travel with
 * their message; only the last user message carries them in full.
 */
export function toModelMessages(rows: StoredMessage[]): Anthropic.MessageParam[] {
  const firstUser = rows.findIndex((row) => row.role === "user");
  if (firstUser === -1) return [];
  const lastUser = rows.findLastIndex((row) => row.role === "user");
  return rows
    .slice(firstUser)
    .map((row, index) =>
      row.role === "user"
        ? { role: "user", content: userContent(row, firstUser + index === lastUser) }
        : { role: "assistant", content: row.content },
    );
}
