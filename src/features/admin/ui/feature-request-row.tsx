"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatCalendarDate } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { setFeatureRequestStatus } from "../server/mutations";
import { FEATURE_REQUEST_STATUSES } from "../types";
import type { FeatureRequestRow, FeatureRequestStatus } from "../types";

/** One idea with a status the owner can change right here; it writes to the audit. */
export function FeatureRequestRowView({ row }: { row: FeatureRequestRow }) {
  const t = useTranslations("admin.feedback");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<FeatureRequestStatus>(row.status);
  const [failed, setFailed] = useState(false);

  function onChange(next: FeatureRequestStatus) {
    const previous = status;
    setStatus(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setFeatureRequestStatus(row.id, next);
      if (!result.ok) {
        setStatus(previous);
        setFailed(true);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-line px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-ink">{row.title}</p>
        <select
          value={status}
          disabled={pending}
          onChange={(event) => onChange(event.target.value as FeatureRequestStatus)}
          className="h-9 shrink-0 rounded-lg border border-line bg-canvas px-2 text-xs text-ink outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
        >
          {FEATURE_REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`status.${value}`)}
            </option>
          ))}
        </select>
      </div>
      {row.description && <p className="text-xs text-ink-soft">{row.description}</p>}
      <p className="text-[11px] text-ink-muted">
        {t("ideaMeta", {
          id: row.userId.slice(0, 8),
          date: formatCalendarDate(row.createdAt.slice(0, 10), ADMIN_FORMAT_SETTINGS),
        })}
      </p>
      {failed && <p className="text-xs text-pink">{t("statusFailed")}</p>}
    </li>
  );
}
