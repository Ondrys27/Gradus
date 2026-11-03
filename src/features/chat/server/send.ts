import { z } from "zod";
import { mentionsIn } from "../logic";
import {
  CHAT_BODY_MAX,
  CHAT_FILE_MAX_BYTES,
  CHAT_FILE_TYPES,
  CHAT_FILES_MAX,
  type ChatAttachment,
  type ChatKind,
  type ChatMessage,
} from "../types";
import { contentMatchesType } from "./file-check";

/**
 * The work of POST /api/chat/messages, without the network: the payload is
 * checked, the direct conversation made at the first message, every file
 * looked at on the server (it must be there, ≤ 10 MB and really what its
 * type says), then the message is written with the user's own client, so
 * the policies and chat_messages_guard decide the rest. The message id comes
 * from the browser, which makes a retry after a lost answer harmless.
 */

const fileSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  mime: z.enum(CHAT_FILE_TYPES),
  width: z.number().int().min(1).max(20000).optional(),
  height: z.number().int().min(1).max(20000).optional(),
});

export const sendPayloadSchema = z
  .strictObject({
    id: z.uuid(),
    channelId: z.uuid().optional(),
    to: z.uuid().optional(),
    body: z.string().max(CHAT_BODY_MAX),
    replyTo: z.uuid().nullable().optional(),
    files: z.array(fileSchema).max(CHAT_FILES_MAX).optional(),
  })
  .refine((value) => Boolean(value.channelId) !== Boolean(value.to), { message: "target" })
  .refine((value) => value.body.trim().length > 0 || (value.files?.length ?? 0) > 0, {
    message: "empty",
  });

export type SendPayload = z.infer<typeof sendPayloadSchema>;

export type SendError =
  | "invalid"
  | "unauthorized"
  | "notFound"
  | "forbidden"
  | "readOnly"
  | "archived"
  | "member"
  | "fileMissing"
  | "fileTooLarge"
  | "fileType";

export type DbFailure = { code?: string; message?: string } | null | undefined;

export type SendDeps = {
  userId: string | null;
  /** chat_open_direct(_to) with the user's client. */
  openDirect: (to: string) => Promise<{ id: string | null; error: DbFailure }>;
  /** The conversation as the user may read it (RLS), or null. */
  channel: (id: string) => Promise<{ owner_id: string; kind: ChatKind; archived_at: string | null } | null>;
  /** Size and first bytes of an uploaded file, or null when it is not there. */
  fileInfo: (path: string) => Promise<{ size: number; head: Uint8Array } | null>;
  removeFile: (path: string) => Promise<void>;
  insert: (row: {
    id: string;
    channel_id: string;
    /** The space; the database sets it from the conversation anyway. */
    owner_id: string;
    body: string;
    attachments: ChatAttachment[];
    reply_to_id: string | null;
  }) => Promise<{ message: ChatMessage | null; error: DbFailure }>;
  /** The message already stored under this id (a retry), readable by the user. */
  existing: (id: string) => Promise<ChatMessage | null>;
};

export type SendResult =
  | {
      ok: true;
      status: 200 | 201;
      message: ChatMessage;
      channel: { id: string; ownerId: string; kind: ChatKind };
      mentions: string[];
      /** A retry of a message already stored: nothing to announce again. */
      repeated: boolean;
    }
  | { ok: false; status: 400 | 401 | 403 | 404 | 409; error: SendError };

/** The error of the database as the route answers it. */
export function sendErrorOf(error: DbFailure): { status: 400 | 403 | 404 | 409; error: SendError } | null {
  const text = `${error?.message ?? ""}`;
  if (/read_only/.test(text)) return { status: 403, error: "readOnly" };
  if (/chat_channel_archived/.test(text)) return { status: 409, error: "archived" };
  if (/chat_member_invalid/.test(text)) return { status: 400, error: "member" };
  if (/chat_channel_not_found/.test(text)) return { status: 404, error: "notFound" };
  if (/chat_not_member|row-level security|insufficient_privilege/.test(text) || error?.code === "42501") {
    return { status: 403, error: "forbidden" };
  }
  if (/chat_message_empty|chat_attachments_invalid|chat_reply_outside/.test(text) || error?.code === "23514") {
    return { status: 400, error: "invalid" };
  }
  return null;
}

export async function sendChatMessage(payload: unknown, deps: SendDeps): Promise<SendResult> {
  if (!deps.userId) return { ok: false, status: 401, error: "unauthorized" };
  const parsed = sendPayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, status: 400, error: "invalid" };
  const input = parsed.data;

  let channelId = input.channelId ?? null;
  if (input.to) {
    const opened = await deps.openDirect(input.to);
    if (opened.error || !opened.id) {
      const known = sendErrorOf(opened.error);
      if (known) return { ok: false, ...known };
      throw new Error(`chat_open_direct failed: ${opened.error?.code ?? "unknown"}`);
    }
    channelId = opened.id;
  }
  const channel = await deps.channel(channelId!);
  if (!channel) return { ok: false, status: 404, error: "notFound" };
  if (channel.archived_at) return { ok: false, status: 409, error: "archived" };

  const already = await deps.existing(input.id);
  if (already) {
    return {
      ok: true,
      status: 200,
      message: already,
      channel: { id: channelId!, ownerId: channel.owner_id, kind: channel.kind },
      mentions: mentionsIn(already.body),
      repeated: true,
    };
  }

  const attachments: ChatAttachment[] = [];
  for (const file of input.files ?? []) {
    const path = `${channel.owner_id}/${input.id}/${file.id}`;
    const info = await deps.fileInfo(path);
    if (!info) return { ok: false, status: 400, error: "fileMissing" };
    if (info.size < 1 || info.size > CHAT_FILE_MAX_BYTES) {
      await deps.removeFile(path);
      return { ok: false, status: 400, error: "fileTooLarge" };
    }
    if (!contentMatchesType(file.mime, info.head)) {
      await deps.removeFile(path);
      return { ok: false, status: 400, error: "fileType" };
    }
    attachments.push({
      path,
      name: file.name,
      size: info.size,
      mime: file.mime,
      ...(file.width && file.height ? { width: file.width, height: file.height } : {}),
    });
  }

  const inserted = await deps.insert({
    id: input.id,
    channel_id: channelId!,
    owner_id: channel.owner_id,
    body: input.body,
    attachments,
    reply_to_id: input.replyTo ?? null,
  });
  if (inserted.error || !inserted.message) {
    if (inserted.error?.code === "23505") {
      const stored = await deps.existing(input.id);
      if (stored) {
        return {
          ok: true,
          status: 200,
          message: stored,
          channel: { id: channelId!, ownerId: channel.owner_id, kind: channel.kind },
          mentions: mentionsIn(stored.body),
          repeated: true,
        };
      }
      return { ok: false, status: 409, error: "invalid" };
    }
    const known = sendErrorOf(inserted.error);
    if (known) return { ok: false, ...known };
    throw new Error(`chat message insert failed: ${inserted.error?.code ?? "unknown"}`);
  }
  return {
    ok: true,
    status: 201,
    message: inserted.message,
    channel: { id: channelId!, ownerId: channel.owner_id, kind: channel.kind },
    mentions: mentionsIn(inserted.message.body),
    repeated: false,
  };
}
