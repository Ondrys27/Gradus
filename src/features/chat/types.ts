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
