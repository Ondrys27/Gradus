"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ListChecksIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/features/account/workspace-queries";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { canCreateTask } from "./access";
import { sortTasks } from "./logic";
import { useTargetTasks } from "./queries";
import { TaskDialog } from "./task-dialog";
import { TaskRow } from "./task-row";
import { crmTiming } from "./timing";
import { TASKS_PATH, type TaskTarget } from "./types";
import { useMinuteClock, useTaskDialogs } from "./use-task-dialogs";

type Props = {
  kind: "deal" | "contact";
  id: string;
  /** Prefilled in a new task: the deal with its contact, or the contact. */
  target: TaskTarget;
  className?: string;
};

/**
 * "Úkoly" in the detail of a deal or a contact: the open tasks by due, adding
 * one with the deal or contact filled in, and the done ones folded below.
 */
export function TargetTasks({ kind, id, target, className }: Props) {
  const t = useTranslations("crmTasks.section");
  const settings = useFormatSettings();
  const workspace = useWorkspace();
  const tasks = useTargetTasks(kind, id);
  const now = useMinuteClock();
  const actions = useTaskDialogs(now);
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const canAdd = canCreateTask(workspace, {
    deal: target.deal !== null,
    contact: target.contact !== null,
  });

  const { open, done } = useMemo(() => {
    const list = sortTasks(tasks.data ?? [], crmTiming, settings.timeZone);
    return {
      open: list.filter((task) => task.status === "open"),
      done: list.filter((task) => task.status === "done"),
    };
  }, [tasks.data, settings.timeZone]);

  const headingId = `${kind}-tasks-${id}`;
  return (
    <section aria-labelledby={headingId} className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={headingId} className="micro-label">
          {t("title")}
        </h3>
        {canAdd && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            {t("add")}
          </Button>
        )}
      </div>

      {tasks.isPending ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : tasks.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : (
        <>
          {open.length === 0 ? (
            <p className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-4 text-sm text-ink-muted">
              <ListChecksIcon aria-hidden className="size-4 shrink-0" />
              {t("empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {open.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  now={now}
                  hideTarget={kind}
                  onOpen={actions.open}
                  onComplete={actions.complete}
                  onReopen={actions.reopen}
                />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                aria-expanded={showDone}
                onClick={() => setShowDone((value) => !value)}
                className="flex min-h-11 cursor-pointer items-center gap-1.5 self-start rounded-lg text-sm text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8"
              >
                <ChevronDownIcon
                  aria-hidden
                  className={cn("size-4 transition-transform", !showDone && "-rotate-90")}
                />
                {t("done", { count: formatNumber(done.length, {}, settings) })}
              </button>
              {showDone && (
                <ul className="flex flex-col gap-2">
                  {done.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      now={now}
                      hideTarget={kind}
                      onOpen={actions.open}
                      onComplete={actions.complete}
                      onReopen={actions.reopen}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
          {actions.reopenFailed && <FormAlert>{t("reopenFailed")}</FormAlert>}
          <Link
            href={`${TASKS_PATH}?${kind}=${id}`}
            className="self-start text-xs text-ink-muted underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:ring-3 focus-visible:ring-violet/40"
          >
            {t("showInTasks")}
          </Link>
        </>
      )}

      <TaskDialog open={adding} onOpenChange={setAdding} target={target} origin={kind} />
      {actions.dialogs}
    </section>
  );
}
