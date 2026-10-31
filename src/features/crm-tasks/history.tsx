"use client";

import { CircleCheckBigIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { ActorAvatar } from "@/features/account/members";
import { formatDateTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useTargetTasks } from "./queries";
import type { CrmTask } from "./types";

/**
 * The finished tasks of a deal or a contact, for its history: computed from
 * the tasks themselves, never copied into the activities. Undefined while
 * loading, so the history waits for both.
 */
export function useFinishedTasks(kind: "deal" | "contact", id: string): CrmTask[] | undefined {
  const tasks = useTargetTasks(kind, id);
  if (!tasks.data) return tasks.isError ? [] : undefined;
  return tasks.data.filter((task) => task.status === "done" && task.completed_at);
}

/** One finished task in a history: when, who, the task and the note written with it. */
export function TaskHistoryItem({ task }: { task: CrmTask }) {
  const t = useTranslations("crmTasks.history");
  const settings = useFormatSettings();
  return (
    <li className="flex gap-3 border-b border-line/60 py-3 last:border-b-0">
      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface-hover text-green">
        <CircleCheckBigIcon aria-hidden className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium text-ink">{t("done")}</span>
          <ActorAvatar actorId={task.completed_by} className="size-5" />
          <time dateTime={task.completed_at!} className="text-xs text-ink-muted">
            {formatDateTime(new Date(task.completed_at!), settings)}
          </time>
        </p>
        <p className="text-sm text-ink [overflow-wrap:anywhere]">{task.title}</p>
        {task.completion_note && (
          <p className="text-sm whitespace-pre-line text-ink-soft [overflow-wrap:anywhere]">
            {task.completion_note}
          </p>
        )}
      </div>
    </li>
  );
}
