"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, FileTextIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSession } from "@/features/account/queries";
import { useCan, useWorkspaceId } from "@/features/account/workspace-queries";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";

/** Attachments of a deal (transcripts of meetings), newest first; the text is read only on download. */
const LIST_LIMIT = 20;

type Attachment = { id: string; name: string; created_at: string };

const attachmentKeys = {
  list: (userId: string, dealId: string) => ["pipeline", userId, "attachments", dealId] as const,
};

function useDealAttachments(dealId: string) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: attachmentKeys.list(user.id, dealId),
    queryFn: async (): Promise<Attachment[]> => {
      const { data, error } = await createClient()
        .from("deal_attachments")
        .select("id, name, created_at")
        .eq("user_id", workspaceId)
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

/** Downloads one transcript as a text file, read with the user's own client (RLS). */
async function download(attachment: Attachment) {
  const { data, error } = await createClient()
    .from("deal_attachments")
    .select("content")
    .eq("id", attachment.id)
    .single();
  if (error) throw error;
  const blob = new Blob([data.content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.name.endsWith(".txt") ? attachment.name : `${attachment.name}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Transcripts kept with a deal ("Paste meeting notes", 28.7); hidden while there are none. */
export function DealAttachments({ dealId }: { dealId: string }) {
  const t = useTranslations("meetingNotes.attachments");
  const { user } = useSession();
  const format = useFormatSettings();
  const canEdit = useCan("pipeline", "update");
  const queryClient = useQueryClient();
  const list = useDealAttachments(dealId);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient().from("deal_attachments").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: attachmentKeys.list(user.id, dealId) }),
  });

  if (!list.data?.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby={`deal-attachments-${dealId}`}>
      <h3 id={`deal-attachments-${dealId}`} className="micro-label">
        {t("title")}
      </h3>
      <ul className="flex flex-col gap-1">
        {list.data.map((attachment) => (
          <li key={attachment.id} className="flex items-center gap-2 text-sm">
            <FileTextIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
            <span className="text-xs text-ink-muted">
              {formatDate(new Date(attachment.created_at), format)}
            </span>
            <button
              type="button"
              aria-label={t("download", { name: attachment.name })}
              onClick={() => void download(attachment)}
              className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-8"
            >
              <DownloadIcon aria-hidden className="size-4" />
            </button>
            {canEdit && (
              <button
                type="button"
                aria-label={t("delete", { name: attachment.name })}
                onClick={() => setRemoving(attachment)}
                className="grid size-11 cursor-pointer place-items-center rounded-full text-destructive outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-8"
              >
                <Trash2Icon aria-hidden className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("deleteTitle")}
        description={t("deleteDescription", { name: removing?.name ?? "" })}
        confirmLabel={t("deleteConfirm")}
        cancelLabel={t("cancel")}
        closeLabel={t("cancel")}
        pending={remove.isPending}
        error={remove.isError ? t("deleteFailed") : null}
        onConfirm={() =>
          removing && remove.mutate(removing.id, { onSuccess: () => setRemoving(null) })
        }
      />
    </section>
  );
}
