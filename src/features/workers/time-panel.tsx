"use client";

import { TimerIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDate, formatNumber, formatTime, splitDuration } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useWorkerSessions } from "./queries";

/** The latest work sessions, each with its effective end (idle time already cut). */
export function TimePanel({ workerId }: { workerId: string }) {
  const t = useTranslations("workers.time");
  const settings = useFormatSettings();
  const sessions = useWorkerSessions(workerId);

  if (sessions.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (!sessions.data) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (sessions.data.length === 0) {
    return <EmptyState icon={<TimerIcon />} title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="micro-label">{t("recent")}</h3>
      <ul className="flex flex-col gap-2">
        {sessions.data.map((session) => {
          const start = new Date(session.started_at);
          const end = new Date(session.effective_end);
          const { hours, minutes } = splitDuration(
            Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)),
          );
          return (
            <li
              key={session.id}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface/70 px-4 py-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium text-ink">{formatDate(start, settings)}</span>
                <span className="text-xs text-ink-muted tabular-nums">
                  {t("range", { from: formatTime(start, settings), to: formatTime(end, settings) })}
                </span>
              </div>
              {session.running ? (
                <StatusPill tone="teal" dot>
                  {t("running")}
                </StatusPill>
              ) : session.end_reason === "idle" ? (
                <StatusPill tone="gold">{t("idle")}</StatusPill>
              ) : null}
              <span className="w-20 text-right font-semibold text-ink tabular-nums">
                {t("duration", {
                  hours: formatNumber(hours, {}, settings),
                  minutes: formatNumber(minutes, {}, settings),
                })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
