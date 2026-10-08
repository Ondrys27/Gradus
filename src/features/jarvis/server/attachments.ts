import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormatSettings } from "@/lib/format";
import { track } from "@/lib/analytics/track";
import type { Database } from "@/types/database";
import { cleanFileName, isImageKind, MAX_FILE_BYTES, MIME_BY_KIND, type FileKind } from "../files";
import type { HistoryAttachment } from "../history";
import type { AttachmentRef, ChatAttachment, FileErrorCode } from "../protocol";
import { extractText, UnreadableFileError, type Extracted } from "./extract";
import { detectFileKind } from "./file-type";
import { prepareImage, type ModelImage } from "./images";
import { loadFileUsage } from "./usage";

type Client = SupabaseClient<Database>;

export const ATTACHMENTS_BUCKET = "attachments";
export const MESSAGE_ENTITY = "jarvis_message";

export type PreparedFile = {
  path: string;
  name: string;
  kind: FileKind;
  size: number;
  extracted: Extracted | null;
  image: ModelImage | null;
};

/** Jarvis files live in <user id>/jarvis/<uuid>; anything else is not the user's upload. */
export function isOwnUploadPath(path: string, userId: string): boolean {
  return new RegExp(
    `^${userId}/jarvis/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
  ).test(path);
}

class FileRefused extends Error {
  constructor(
    readonly code: FileErrorCode,
    readonly detail: string,
  ) {
    super(detail);
  }
}

async function readOne(supabase: Client, ref: AttachmentRef): Promise<PreparedFile> {
  const name = cleanFileName(ref.name);
  // Downloaded with the user's own client: storage RLS keeps it to their folder.
  const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(ref.path);
  if (error || !data)
    throw new FileRefused("fileMissing", `${name}: ${error?.message ?? "no data"}`);
  if (data.size > MAX_FILE_BYTES) throw new FileRefused("fileTooLarge", `${name}: ${data.size} B`);
  const bytes = new Uint8Array(await data.arrayBuffer());

  const kind = detectFileKind(bytes, name);
  if (!kind) throw new FileRefused("fileType", `${name}: content is not an allowed type`);

  try {
    if (isImageKind(kind)) {
      return {
        path: ref.path,
        name,
        kind,
        size: bytes.length,
        extracted: null,
        image: await prepareImage(bytes, kind),
      };
    }
    return {
      path: ref.path,
      name,
      kind,
      size: bytes.length,
      extracted: await extractText(kind, bytes),
      image: null,
    };
  } catch (error) {
    const reason = error instanceof UnreadableFileError ? error.message : String(error);
    throw new FileRefused("fileUnreadable", `${name}: ${reason}`);
  }
}

export type PrepareResult =
  { ok: true; files: PreparedFile[] } | { ok: false; code: FileErrorCode };

/**
 * Checks the files of one message before anything is saved: they are the
 * user's own uploads, fit the monthly number of the plan, are at most 10 MB
 * and are really one of the allowed types by content. Text comes out of the
 * documents here and images are prepared for the model. A refused message
 * leaves no files behind; the refusal is recorded as an analytics event.
 */
export async function prepareAttachments(args: {
  supabase: Client;
  admin: Client;
  userId: string;
  settings: FormatSettings;
  refs: AttachmentRef[];
}): Promise<PrepareResult> {
  const { supabase, admin, userId, settings } = args;
  const refs = [...new Map(args.refs.map((ref) => [ref.path, ref])).values()];
  if (!refs.length) return { ok: true, files: [] };

  const refuse = async (code: FileErrorCode, detail: string): Promise<PrepareResult> => {
    const own = refs.map((ref) => ref.path).filter((path) => isOwnUploadPath(path, userId));
    if (own.length) {
      const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).remove(own);
      if (error) console.error("jarvis attachment cleanup failed", error);
    }
    // The detail (file name, size) stays in the server log; the event keeps only the reason.
    console.warn(`jarvis file refused: ${code}`, detail.slice(0, 300));
    await track("jarvis_file_rejected", { reason: code }, { userId, admin });
    return { ok: false, code };
  };

  if (refs.some((ref) => !isOwnUploadPath(ref.path, userId))) {
    return refuse("fileMissing", "path outside the user's jarvis folder");
  }

  const usage = await loadFileUsage(supabase, admin, userId, settings);
  if (usage.used + refs.length > usage.limit) {
    return refuse("fileLimit", `${usage.used} + ${refs.length} > ${usage.limit}`);
  }

  try {
    const files = await Promise.all(refs.map((ref) => readOne(supabase, ref)));
    return { ok: true, files };
  } catch (error) {
    if (error instanceof FileRefused) return refuse(error.code, error.detail);
    throw error;
  }
}

/**
 * Records accepted files on the saved message (server-only rows with the type
 * detected from the content) and counts them as analytics events (the plan's
 * monthly number of files is read from those).
 */
export async function recordAttachments(
  admin: Client,
  userId: string,
  messageId: string,
  files: PreparedFile[],
): Promise<ChatAttachment[]> {
  if (!files.length) return [];
  const { data, error } = await admin
    .from("attachments")
    .insert(
      files.map((file) => ({
        user_id: userId,
        entity_type: MESSAGE_ENTITY,
        entity_id: messageId,
        storage_path: file.path,
        file_name: file.name,
        mime_type: MIME_BY_KIND[file.kind],
        size_bytes: file.size,
        extracted_text: file.extracted?.text ?? null,
      })),
    )
    .select("id, storage_path");
  if (error) throw error;
  await Promise.all(
    files.map((file) =>
      track(
        "jarvis_file_attached",
        { kind: file.kind, size_kb: Math.min(20_000, Math.ceil(file.size / 1024)) },
        { userId, admin },
      ),
    ),
  );
  const ids = new Map(data.map((row) => [row.storage_path, row.id]));
  return files.map((file) => ({
    id: ids.get(file.path) ?? file.path,
    name: file.name,
    kind: file.kind,
  }));
}

/** The files of the message being sent, as the model gets them. */
export function currentTurnAttachments(files: PreparedFile[]): HistoryAttachment[] {
  return files.map((file) => ({
    name: file.name,
    kind: file.kind,
    text: file.extracted?.text ?? null,
    truncated: file.extracted?.truncated,
    image: file.image ?? undefined,
  }));
}

const KIND_BY_MIME = new Map(
  Object.entries(MIME_BY_KIND).map(([kind, mime]) => [mime, kind as FileKind]),
);

export function kindOfMime(mime: string): FileKind {
  return KIND_BY_MIME.get(mime) ?? "txt";
}

/** Files of earlier messages in the history, read with the user's own client. */
export async function loadHistoryAttachments(
  supabase: Client,
  messageIds: string[],
): Promise<Map<string, HistoryAttachment[]>> {
  const byMessage = new Map<string, HistoryAttachment[]>();
  if (!messageIds.length) return byMessage;
  const { data, error } = await supabase
    .from("attachments")
    .select("entity_id, file_name, mime_type, extracted_text")
    .eq("entity_type", MESSAGE_ENTITY)
    .in("entity_id", messageIds)
    .order("created_at")
    .limit(messageIds.length * 3);
  if (error) throw error;
  for (const row of data) {
    const list = byMessage.get(row.entity_id) ?? [];
    list.push({ name: row.file_name, kind: kindOfMime(row.mime_type), text: row.extracted_text });
    byMessage.set(row.entity_id, list);
  }
  return byMessage;
}
