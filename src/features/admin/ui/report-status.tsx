"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { setBugReportStatus } from "../server/mutations";
import { BUG_REPORT_STATUSES } from "../types";
import type { BugReportStatus } from "../types";

/** The status of a bug report, changed right here; it writes to the audit and, for Fixed, thanks the author. */
export function ReportStatusSelect({ id, status }: { id: string; status: BugReportStatus }) {
  const t = useTranslations("admin.feedback");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<BugReportStatus>(status);
  const [failed, setFailed] = useState(false);

  function onChange(next: BugReportStatus) {
    const previous = value;
    setValue(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setBugReportStatus(id, next);
      if (!result.ok) {
        setValue(previous);
        setFailed(true);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        value={value}
        disabled={pending}
        aria-label={t("reportStatusLabel")}
        data-testid="report-status"
        onChange={(event) => onChange(event.target.value as BugReportStatus)}
        className="h-10 rounded-lg border border-line bg-canvas px-2 text-sm text-ink outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-9"
      >
        {BUG_REPORT_STATUSES.map((option) => (
          <option key={option} value={option}>
            {t(`reportStatus.${option}`)}
          </option>
        ))}
      </select>
      {value === "fixed" && <p className="text-xs text-ink-muted">{t("fixedNotice")}</p>}
      {failed && <p className="text-xs text-pink">{t("statusFailed")}</p>}
    </div>
  );
}
