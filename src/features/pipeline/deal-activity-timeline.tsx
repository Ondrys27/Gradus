"use client";

import { HistoryIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { ACTIVITY_ICONS } from "@/features/contacts/activity-panel";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useDealActivities } from "./queries";

/**
 * The deal's own communication history (e-mails sent from its detail), read
 * only: activities are added by sending an e-mail, not typed in here.
 */
export function DealActivityTimeline({ dealId }: { dealId: string }) {
  const t = useTranslations("contacts.activity");
  const settings = useFormatSettings();
  const activities = useDealActivities(dealId);

  if (activities.isPending) return <Skeleton className="h-16 rounded-xl" />;
  if (activities.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (activities.data.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-4 text-sm text-ink-muted">
        <HistoryIcon aria-hidden className="size-4 shrink-0" />
        {t("empty")}
      </p>
    );
  }

  return (
    <ol className="flex flex-col">
      {activities.data.map((activity) => {
        const Icon = ACTIVITY_ICONS[activity.type];
        return (
          <li key={activity.id} className="flex gap-3 border-b border-line/60 py-3 last:border-b-0">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface-hover text-ink-soft">
              <Icon aria-hidden className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-ink">{t(`types.${activity.type}`)}</span>
                <time dateTime={activity.occurred_at} className="text-xs text-ink-muted">
                  {formatDateTime(new Date(activity.occurred_at), settings)}
                </time>
              </p>
              {activity.content && (
                <p className="text-sm whitespace-pre-line text-ink-soft">{activity.content}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
