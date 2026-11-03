"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  DownloadIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  ImageIcon,
  PencilIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/features/account/workspace-queries";
import { useAssigneeName } from "@/features/crm-tasks/use-assignee-name";
import { formatDate, formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { WORKER_DOCUMENT_MIMES } from "../permissions-catalog";
import { DOCUMENT_NAME_MAX, documentKind, type DocumentError } from "./documents-logic";
import {
  documentDownloadUrl,
  documentFailureReason,
  useDeleteDocument,
  useRenameDocument,
  useUploadDocument,
  useWorkerDocuments,
  type WorkerDocument,
} from "./documents-queries";
import type { DashboardWorker } from "./types";

const KIND_ICON = {
  pdf: FileTextIcon,
  image: ImageIcon,
  office: FileSpreadsheetIcon,
  text: FileIcon,
} as const;

/**
 * The person's documents (contract, certificates…). The owner, and whoever
 * may edit the person in Company, upload by dropping files or the button,
 * rename, download and delete; the person themself only reads and downloads.
 */
export function DocumentsTab({ worker }: { worker: DashboardWorker }) {
  const t = useTranslations("workers.dashboard.documents");
  const workspace = useWorkspace();
  const editable = worker.canEdit && !workspace.readOnly;
  const documents = useWorkerDocuments(worker.id);
  const upload = useUploadDocument(worker.id);
  const remove = useDeleteDocument(worker.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<DocumentError | null>(null);
  const [deleting, setDeleting] = useState<WorkerDocument | null>(null);
  const [uploading, setUploading] = useState(0);

  async function add(files: FileList | File[] | null) {
    if (!files || !editable) return;
    setError(null);
    const list = [...files];
    setUploading(list.length);
    for (const file of list) {
      try {
        await upload.mutateAsync(file);
      } catch (cause) {
        setError(documentFailureReason(cause));
      }
      setUploading((left) => left - 1);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void add(event.dataTransfer.files);
  }

  return (
    <div className="flex flex-col gap-4">
      {editable ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-3 rounded-card border border-dashed p-6 text-center transition-colors motion-reduce:transition-none",
            dragging ? "border-violet bg-violet/10" : "border-line-strong bg-canvas-deep/30",
          )}
        >
          <UploadIcon aria-hidden className="size-6 text-violet" />
          <p className="text-sm text-ink">{t("drop")}</p>
          <p className="text-xs text-ink-muted">{t("hint")}</p>
          <Button
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={uploading > 0}
          >
            <UploadIcon aria-hidden data-icon="inline-start" />
            {uploading > 0 ? t("uploading", { count: uploading }) : t("upload")}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={WORKER_DOCUMENT_MIMES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-label={t("upload")}
            data-testid="worker-documents-input"
            onChange={(event) => {
              void add(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      ) : (
        <p className="text-sm text-ink-muted">{t("readOnlyNote")}</p>
      )}

      {error && <FormAlert>{t(`errors.${error}`)}</FormAlert>}

      <GlowCard interactive={false} className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">{t("title")}</h3>
        {documents.isError ? (
          <FormAlert>{t("errors.loadFailed")}</FormAlert>
        ) : documents.isPending ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : documents.data.length === 0 ? (
          <p className="py-4 text-sm text-ink-muted">{t("empty")}</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {documents.data.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                workerId={worker.id}
                editable={editable}
                onDelete={() => setDeleting(document)}
                onError={setError}
              />
            ))}
          </ul>
        )}
      </GlowCard>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteTitle")}
        description={t("deleteDescription", { name: deleting?.name ?? "" })}
        confirmLabel={t("deleteConfirm")}
        cancelLabel={t("cancel")}
        closeLabel={t("cancel")}
        pending={remove.isPending}
        error={remove.isError ? t(`errors.${documentFailureReason(remove.error)}`) : null}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting, { onSuccess: () => setDeleting(null) });
        }}
      />
    </div>
  );
}

function DocumentRow({
  document,
  workerId,
  editable,
  onDelete,
  onError,
}: {
  document: WorkerDocument;
  workerId: string;
  editable: boolean;
  onDelete: () => void;
  onError: (error: DocumentError | null) => void;
}) {
  const t = useTranslations("workers.dashboard.documents");
  const settings = useFormatSettings();
  const personName = useAssigneeName();
  const rename = useRenameDocument(workerId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(document.name);
  const [downloading, setDownloading] = useState(false);
  const Icon = KIND_ICON[documentKind(document.mime)];

  function save() {
    const next = name.trim();
    setEditing(false);
    if (!next || next === document.name) {
      setName(document.name);
      return;
    }
    rename.mutate(
      { id: document.id, name: next },
      {
        onError: (cause) => {
          setName(document.name);
          onError(documentFailureReason(cause));
        },
      },
    );
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") save();
    if (event.key === "Escape") {
      setName(document.name);
      setEditing(false);
    }
  }

  async function download() {
    setDownloading(true);
    onError(null);
    try {
      window.location.assign(await documentDownloadUrl(document));
    } catch {
      onError("saveFailed");
    } finally {
      setDownloading(false);
    }
  }

  const size =
    document.size >= 1024 * 1024
      ? t("sizeMb", {
          size: formatNumber(document.size / (1024 * 1024), { decimals: 1 }, settings),
        })
      : t("sizeKb", {
          size: formatNumber(Math.max(1, Math.round(document.size / 1024)), {}, settings),
        });

  return (
    <li
      data-testid="worker-document-row"
      className="flex min-h-11 items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-hover"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-hover text-ink-soft">
        <Icon aria-hidden className="size-4.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {editing ? (
          <Input
            autoFocus
            value={name}
            maxLength={DOCUMENT_NAME_MAX}
            aria-label={t("renameLabel")}
            onChange={(event) => setName(event.target.value)}
            onBlur={save}
            onKeyDown={onKey}
          />
        ) : (
          <span className="truncate text-sm font-medium text-ink">{name}</span>
        )}
        <span className="text-xs text-ink-muted">
          {t("meta", {
            size,
            date: formatDate(new Date(document.created_at), settings),
            name: personName(document.uploaded_by),
          })}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("download", { name: document.name })}
          onClick={() => void download()}
          disabled={downloading}
        >
          <DownloadIcon aria-hidden />
        </Button>
        {editable && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("rename", { name: document.name })}
              onClick={() => setEditing(true)}
            >
              <PencilIcon aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              aria-label={t("delete", { name: document.name })}
              onClick={onDelete}
            >
              <Trash2Icon aria-hidden />
            </Button>
          </>
        )}
      </span>
    </li>
  );
}
