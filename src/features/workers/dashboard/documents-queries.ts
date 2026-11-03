"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import {
  checkDocument,
  documentKind,
  documentMime,
  documentName,
  type DocumentError,
} from "./documents-logic";
import { dashboardKeys } from "./queries";

/**
 * A person's documents: rows in worker_documents, files in the private bucket
 * worker-documents at <owner>/<worker>/<document id>. The owner and whoever
 * may edit the person in Company manage them, the person reads them; the
 * database refuses everybody else.
 */

export const WORKER_DOCUMENTS_BUCKET = "worker-documents";
const DOCUMENTS_LIMIT = 200;
const DOCUMENT_COLUMNS = "id, name, path, size, mime, uploaded_by, created_at" as const;
/** Long enough to start a download, short enough not to be shared. */
const SIGNED_URL_SECONDS = 60;

export type WorkerDocument = {
  id: string;
  name: string;
  path: string;
  size: number;
  mime: string;
  uploaded_by: string | null;
  created_at: string;
};

export function documentErrorOf(cause: unknown): DocumentError {
  const message = (cause as { message?: string } | null)?.message ?? "";
  if (message.includes("read_only")) return "readOnly";
  return "saveFailed";
}

function documentsKey(userId: string, workerId: string) {
  return [...dashboardKeys.all(userId, workerId), "documents"] as const;
}

export function useWorkerDocuments(workerId: string) {
  const { user } = useSession();
  return useQuery({
    queryKey: documentsKey(user.id, workerId),
    queryFn: async (): Promise<WorkerDocument[]> => {
      const { data, error } = await createClient()
        .from("worker_documents")
        .select(DOCUMENT_COLUMNS)
        .eq("worker_id", workerId)
        .order("created_at", { ascending: false })
        .limit(DOCUMENTS_LIMIT);
      if (error) throw error;
      return data.map((row) => ({ ...row, size: Number(row.size) }));
    },
  });
}

/** Uploads the file first, then records it; a failed record takes the file away again. */
export function useUploadDocument(workerId: string) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const problem = checkDocument(file);
      if (problem) throw new DocumentFailure(problem);
      const mime = documentMime(file)!;
      const id = crypto.randomUUID();
      const path = `${workspaceId}/${workerId}/${id}`;
      const supabase = createClient();
      const storage = supabase.storage.from(WORKER_DOCUMENTS_BUCKET);
      const { error: uploadError } = await storage.upload(path, file, {
        contentType: mime,
        upsert: false,
      });
      if (uploadError) throw new DocumentFailure("uploadFailed");
      const { error } = await supabase.from("worker_documents").insert({
        id,
        owner_id: workspaceId,
        worker_id: workerId,
        name: documentName(file.name),
        path,
        size: file.size,
        mime,
      });
      if (error) {
        await storage.remove([path]);
        throw new DocumentFailure(documentErrorOf(error));
      }
      track("worker_document_uploaded", {
        kind: documentKind(mime),
        size_kb: Math.min(Math.ceil(file.size / 1024), 20_480),
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: documentsKey(user.id, workerId) }),
  });
}

export function useRenameDocument(workerId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await createClient()
        .from("worker_documents")
        .update({ name: documentName(name) })
        .eq("id", id);
      if (error) throw new DocumentFailure(documentErrorOf(error));
      track("worker_document_renamed", {});
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: documentsKey(user.id, workerId) }),
  });
}

/** The row goes first (that is what decides), then the file. */
export function useDeleteDocument(workerId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (document: WorkerDocument) => {
      const supabase = createClient();
      const { error } = await supabase.from("worker_documents").delete().eq("id", document.id);
      if (error) throw new DocumentFailure(documentErrorOf(error));
      await supabase.storage.from(WORKER_DOCUMENTS_BUCKET).remove([document.path]);
      track("worker_document_deleted", {});
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: documentsKey(user.id, workerId) }),
  });
}

/** A link valid for a minute that downloads the file under its name. */
export async function documentDownloadUrl(document: WorkerDocument): Promise<string> {
  const { data, error } = await createClient()
    .storage.from(WORKER_DOCUMENTS_BUCKET)
    .createSignedUrl(document.path, SIGNED_URL_SECONDS, { download: document.name });
  if (error || !data) throw new DocumentFailure("saveFailed");
  return data.signedUrl;
}

export class DocumentFailure extends Error {
  constructor(readonly reason: DocumentError) {
    super(reason);
  }
}

export function documentFailureReason(cause: unknown): DocumentError {
  return cause instanceof DocumentFailure ? cause.reason : documentErrorOf(cause);
}
