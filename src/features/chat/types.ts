/**
 * Messages (Zprávy): the company chat. Group conversations follow the worker
 * groups, direct ones are between two people of the space. A member is named
 * by a token: the owner's user id or the worker's id (chat_members.member,
 * chat_messages.sender). See supabase/migrations/20261103230000_chat.sql.
 */

export const MESSAGES_PATH = "/app/zpravy";

export const CHAT_PAGE_SIZE = 50;
export const CHAT_BODY_MAX = 4000;
/** Own messages can be edited and deleted this long after sending. */
export const CHAT_EDIT_WINDOW_MS = 15 * 60 * 1000;
export const CHAT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_FILES_MAX = 5;
/** Messages of one sender within this gap read as one group of bubbles. */
export const CHAT_GROUP_GAP_MS = 5 * 60 * 1000;
/** A member away this long gets an e-mail about direct messages and mentions. */
export const CHAT_EMAIL_IDLE_MINUTES = 10;

export const CHAT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** What the bucket chat-attachments takes (the same list as the migration). */
export const CHAT_FILE_TYPES = [
  ...CHAT_IMAGE_TYPES,
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/zip",
  "text/plain",
  "text/csv",
] as const;
export type ChatFileType = (typeof CHAT_FILE_TYPES)[number];

/** Names browsers and systems give the same kinds of file (Windows reports a zip as x-zip-compressed). */
const TYPE_ALIASES: Record<string, ChatFileType> = {
  "application/x-zip-compressed": "application/zip",
  "application/x-zip": "application/zip",
  "application/zip-compressed": "application/zip",
  "application/csv": "text/csv",
  "text/x-csv": "text/csv",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
};

/** For a file the system names nothing, or wrongly (a csv as Excel), the extension decides. */
const BY_EXTENSION: Record<string, ChatFileType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  zip: "application/zip",
  txt: "text/plain",
  csv: "text/csv",
};

/** The file picker's filter: the types and their extensions (a zip on Windows is not "application/zip"). */
export const CHAT_FILE_ACCEPT = [...CHAT_FILE_TYPES, ...Object.keys(BY_EXTENSION).map((ext) => `.${ext}`)].join(",");

/**
 * The type a picked file is sent as, or null when the chat does not take it.
 * The server checks the bytes against it anyway (file-check.ts).
 */
export function chatFileType(file: { name: string; type: string }): ChatFileType | null {
  const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  // Windows names a csv "application/vnd.ms-excel"; its bytes are text.
  if (extension === "csv") return "text/csv";
  const reported = file.type.toLowerCase();
  if ((CHAT_FILE_TYPES as readonly string[]).includes(reported)) return reported as ChatFileType;
  if (TYPE_ALIASES[reported]) return TYPE_ALIASES[reported];
  if (!reported || reported === "application/octet-stream") return BY_EXTENSION[extension] ?? null;
  return null;
}

export type ChatKind = "group" | "direct";

export type ChatAttachment = {
  path: string;
  name: string;
  size: number;
  mime: string;
  width?: number;
  height?: number;
};

export type ChatMessage = {
  id: string;
  channel_id: string;
  sender: string | null;
  body: string;
  attachments: ChatAttachment[];
  reply_to_id: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  /** Only in the browser: on its way, or not through yet (sent again on its own). */
  pending?: "sending" | "failed";
  /** Why a message could not be sent (the outbox's error code), shown under it. */
  pendingError?: string;
};

export const CHAT_MESSAGE_COLUMNS =
  "id, channel_id, sender, body, attachments, reply_to_id, created_at, edited_at, deleted_at" as const;

/** One conversation of the list (chat_overview()). */
export type ChatChannel = {
  id: string;
  kind: ChatKind;
  name: string | null;
  color: string | null;
  groupId: string | null;
  archived: boolean;
  mutedAll: boolean;
  muted: boolean;
  pinnedAt: string | null;
  lastReadAt: string | null;
  /** The other person of a direct conversation. */
  peer: string | null;
  memberCount: number;
  createdAt: string;
  last: {
    id: string;
    sender: string | null;
    body: string;
    attachments: number;
    deleted: boolean;
    at: string;
  } | null;
  unread: number;
  mentioned: boolean;
};

/** A person of the space (chat_people()). */
export type ChatPerson = {
  member: string;
  isOwner: boolean;
  name: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  status: "invited" | "active" | "inactive" | null;
  hasAccount: boolean;
};

export type ChatMemberRead = { member: string; last_read_at: string | null };
