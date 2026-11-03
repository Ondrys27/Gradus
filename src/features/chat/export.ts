import { toCsv } from "@/features/account/data-export";
import { formatDateTime, todayIsoDate, type FormatSettings } from "@/lib/format";
import { plainBody } from "./logic";
import type { ChatMessage } from "./types";

/**
 * A conversation as a CSV file for the owner: one row per message, oldest
 * first, the time in the owner's zone and formats, the sender by name,
 * mentions as "@Name", the files by name. A deleted message keeps its row.
 */

export type ChatCsvLabels = {
  time: string;
  sender: string;
  text: string;
  files: string;
  edited: string;
  deleted: string;
  yes: string;
  formerMember: string;
};

export function chatCsv(
  messages: readonly Pick<
    ChatMessage,
    "sender" | "body" | "attachments" | "created_at" | "edited_at" | "deleted_at"
  >[],
  nameOf: (member: string) => string | null,
  settings: FormatSettings,
  labels: ChatCsvLabels,
): string {
  const name = (member: string | null) => (member && nameOf(member)) || labels.formerMember;
  const columns = [labels.time, labels.sender, labels.text, labels.files, labels.edited, labels.deleted];
  const rows = messages.map((message) => ({
    [labels.time]: formatDateTime(new Date(message.created_at), settings),
    [labels.sender]: name(message.sender),
    [labels.text]: plainBody(message.body, (member) => name(member)),
    [labels.files]: message.attachments.map((file) => file.name).join(", "),
    [labels.edited]: message.edited_at ? labels.yes : "",
    [labels.deleted]: message.deleted_at ? labels.yes : "",
  }));
  return toCsv(columns, rows);
}

/** zpravy-obchod-2026-11-03.csv: the conversation's name made safe, the day in the owner's zone. */
export function chatCsvFileName(prefix: string, name: string, settings: FormatSettings, now = new Date()) {
  const slug =
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "chat";
  return `${prefix}-${slug}-${todayIsoDate(settings, now)}.csv`;
}
