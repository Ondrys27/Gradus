"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DownloadIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * The audit export: asks first like every other export, then lets the
 * browser download the file, which the server writes to the audit.
 */
export function AuditExportButton({ href, label }: { href: string; label: string }) {
  const t = useTranslations("admin.chart");
  const [asking, setAsking] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm font-medium text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:h-9"
      >
        <DownloadIcon aria-hidden className="size-4" />
        {label}
      </button>
      {asking && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setAsking(false)}
          title={label}
          description={t("confirmExport")}
          confirmLabel={t("confirm")}
          cancelLabel={t("cancel")}
          closeLabel={t("cancel")}
          onConfirm={() => {
            setAsking(false);
            window.location.assign(href);
          }}
        />
      )}
    </>
  );
}
