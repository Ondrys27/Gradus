"use client";

import { useState } from "react";
import { HistoryIcon, NetworkIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { formatDateTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { useNoteVersions, type NoteVersion } from "./queries";

/**
 * Who wrote the note and when, newest first (live writing puts everyone who
 * wrote in those ten minutes into one version); any older version comes back
 * with Restore (one more change, so the state it replaces stays a version too).
 * Readers see the history, only the owner and editors restore.
 */
export function VersionsDialog({
  noteId,
  open,
  canRestore,
  onClose,
  onRestore,
}: {
  noteId: string;
  open: boolean;
  canRestore: boolean;
  onClose: () => void;
  onRestore: (version: NoteVersion) => Promise<void>;
}) {
  const t = useTranslations("notes.versions");
  const settings = useFormatSettings();
  const versions = useNoteVersions(noteId, open);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = versions.data ?? [];

  async function restore(version: NoteVersion) {
    setBusy(version.id);
    setError(null);
    try {
      await onRestore(version);
      onClose();
    } catch {
      setError(t("error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,520px)]"
    >
      <div className="flex flex-col gap-3" data-testid="note-versions">
        <p className="text-sm text-ink-muted">{t("hint")}</p>
        {versions.isPending ? (
          <div className="flex flex-col gap-3" aria-hidden>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : list.length === 0 ? (
          <p className="py-4 text-sm text-ink-muted">{t("empty")}</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {list.map((version, index) => (
              <li
                key={version.id}
                data-testid="note-version"
                className={cn(
                  "flex items-start gap-3 rounded-xl px-2 py-2.5",
                  index === 0 && "bg-surface/60",
                )}
              >
                {version.kind === "mindmap" ? (
                  <NetworkIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-teal" />
                ) : (
                  <HistoryIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium text-ink" data-testid="note-version-authors">
                      {(version.authorNames.length > 0 ? version.authorNames : [version.savedByName])
                        .filter(Boolean)
                        .join(", ") || t("someone")}
                    </span>
                    <time dateTime={version.updatedAt} className="text-ink-muted tabular-nums">
                      {formatDateTime(new Date(version.updatedAt), settings)}
                    </time>
                    {index === 0 && <span className="text-xs font-semibold text-teal">{t("current")}</span>}
                  </span>
                  <span className="line-clamp-2 text-xs text-ink-muted">{version.excerpt}</span>
                </span>
                {index > 0 && canRestore && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void restore(version)}
                    data-testid="note-version-restore"
                    className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-violet outline-none hover:bg-violet/10 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 mouse:min-h-9"
                  >
                    <RotateCcwIcon aria-hidden className="size-4" />
                    {t("restore")}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
        {error && (
          <p role="alert" className="text-sm text-pink">
            {error}
          </p>
        )}
      </div>
    </ResponsiveDialog>
  );
}
