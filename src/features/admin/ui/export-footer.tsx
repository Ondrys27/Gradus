"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DownloadIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

export type ExportKind = "csv" | "png";

/**
 * The export links of a block, in its footer: every export is written to
 * the audit, so each one asks first. The dialog mounts only while it is
 * open, so a block without a click renders nothing but two small links.
 */
export function ExportFooter({
  kinds,
  onExport,
  disabled,
  failed,
}: {
  kinds: readonly ExportKind[];
  onExport: (kind: ExportKind) => Promise<void>;
  disabled?: boolean;
  failed?: boolean;
}) {
  const t = useTranslations("admin.chart");
  const [asking, setAsking] = useState<ExportKind | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (!asking) return;
    setPending(true);
    try {
      await onExport(asking);
    } finally {
      setPending(false);
      setAsking(null);
    }
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      {failed && (
        <span role="alert" className="mr-2 text-pink">
          {t("exportFailed")}
        </span>
      )}
      {kinds.map((kind) => (
        <button
          key={kind}
          type="button"
          disabled={disabled}
          onClick={() => setAsking(kind)}
          className={cn(
            "flex h-11 cursor-pointer items-center gap-1 rounded-lg px-2 text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50 mouse:h-7",
          )}
        >
          <DownloadIcon aria-hidden className="size-3.5" />
          {kind === "csv" ? t("exportCsv") : t("exportPng")}
        </button>
      ))}
      {asking && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && !pending && setAsking(null)}
          title={asking === "csv" ? t("exportCsv") : t("exportPng")}
          description={t("confirmExport")}
          confirmLabel={t("confirm")}
          cancelLabel={t("cancel")}
          closeLabel={t("cancel")}
          pending={pending}
          onConfirm={() => void confirm()}
        />
      )}
    </div>
  );
}
