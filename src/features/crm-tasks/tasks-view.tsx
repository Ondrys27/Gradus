"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDownIcon, ListChecksIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { Pager } from "@/features/finance/pager";
import { PAGE_SIZE as OWNER_PAGE_SIZE } from "@/features/workers/logic";
import {
  useDoneWorkerTasks,
  useOpenWorkerTasks,
  useSetWorkerTaskStatus,
} from "@/features/workers/queries";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useUrlIntent } from "@/lib/use-url-intent";
import { cn } from "@/lib/utils";
import { canCreateTask } from "./access";
import {
  DEFAULT_FILTERS,
  effectiveStatus,
  filtersToSearch,
  groupTasks,
  ownerTaskPasses,
  parseFilters,
  type TaskFilters,
  type TaskGroup,
} from "./logic";
import { DONE_PAGE_SIZE, OPEN_LIMIT, useCrmTask, useDoneTasks, useOpenTasks } from "./queries";
import { TaskDialog } from "./task-dialog";
import { TaskFilterBar } from "./task-filters";
import { OwnerTaskRow, TaskRow } from "./task-row";
import { itemTiming } from "./timing";
import type { ListItem } from "./types";
import { useMinuteClock, useTaskDialogs } from "./use-task-dialogs";

/**
 * Úkoly: every sales task of the space by due, in groups (overdue, today,
 * tomorrow, this week, later, done folded). A worker also sees the tasks the
 * owner gave them, each marked where it comes from.
 */
export function TasksView() {
  const t = useTranslations("crmTasks");
  const settings = useFormatSettings();
  const workspace = useWorkspace();
  const { user, worker } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseFilters(new URLSearchParams(searchParams)), [searchParams]);
  const now = useMinuteClock();
  const actions = useTaskDialogs(now);
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [donePage, setDonePage] = useState(0);
  const [ownerDonePage, setOwnerDonePage] = useState(0);
  const [requested, setRequested] = useState<string | null>(null);
  const requestedTask = useCrmTask(requested);

  const open = useOpenTasks(filters, settings);
  const done = useDoneTasks(filters, settings, donePage);
  // A worker's own tasks from the owner; nothing is read for an owner.
  const ownerOpen = useOpenWorkerTasks(worker?.id ?? null);
  const ownerDone = useDoneWorkerTasks(worker?.id ?? null, ownerDonePage);
  const setOwnerStatus = useSetWorkerTaskStatus();

  // A link to one task (from Jarvis, the calendar) opens its detail.
  useUrlIntent("task", (id) => {
    setRequested(id);
  });
  const openTask = actions.open;
  useEffect(() => {
    if (!requested || requestedTask.data === undefined) return;
    if (requestedTask.data) openTask(requestedTask.data);
    setRequested(null);
  }, [requested, requestedTask.data, openTask]);

  function apply(next: TaskFilters) {
    setDonePage(0);
    setOwnerDonePage(0);
    router.replace(`${pathname}${filtersToSearch(next, new URLSearchParams(searchParams))}`, {
      scroll: false,
    });
  }

  const status = effectiveStatus(filters);
  const wantsOpen = status !== "done";
  const wantsDone = status !== "open";

  const passes = (task: { due_date: string | null; status: string }) =>
    ownerTaskPasses(
      { dueDay: task.due_date, done: task.status === "done" },
      filters,
      user.id,
      now,
      settings,
    );

  const groups = useMemo(() => {
    const items: ListItem[] = [
      ...(wantsOpen ? (open.data ?? []) : []).map((task): ListItem => ({
        kind: "crm",
        key: `crm:${task.id}`,
        task,
      })),
      ...(wantsOpen && worker ? (ownerOpen.data ?? []) : [])
        .filter(passes)
        .map((task): ListItem => ({ kind: "owner", key: `owner:${task.id}`, task })),
    ];
    return groupTasks(items, itemTiming, now, settings).filter((group) => group.group !== "done");
    // `passes` reads the same filters, user and clock listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open.data, ownerOpen.data, wantsOpen, worker, filters, now, settings, user.id]);

  const doneCrm = wantsDone ? (done.data?.rows ?? []) : [];
  const doneOwner = wantsDone && worker ? (ownerDone.data?.rows ?? []).filter(passes) : [];
  const doneTotal =
    (wantsDone ? (done.data?.total ?? 0) : 0) +
    (wantsDone && worker ? (ownerDone.data?.total ?? 0) : 0);

  const loading =
    (wantsOpen && open.isPending) ||
    (wantsDone && done.isPending) ||
    (worker && ownerOpen.isPending);
  const failed = open.isError || done.isError || ownerOpen.isError || ownerDone.isError;
  const openCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const filtered = filtersToSearch(filters) !== "";
  const canAdd = canCreateTask(workspace, "any");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t(worker ? "workerDescription" : "description")}
        actions={
          canAdd && (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden data-icon="inline-start" />
              {t("new")}
            </Button>
          )
        }
      />

      <TaskFilterBar filters={filters} onChange={apply} />

      {failed && <FormAlert>{t("loadFailed")}</FormAlert>}
      {(actions.reopenFailed || setOwnerStatus.isError) && (
        <FormAlert>{t("section.reopenFailed")}</FormAlert>
      )}

      {loading ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-20 w-full" />
          ))}
        </div>
      ) : openCount === 0 && doneTotal === 0 ? (
        filtered ? (
          <EmptyState
            icon={<ListChecksIcon />}
            title={t("emptyFiltered.title")}
            description={t("emptyFiltered.description")}
            action={
              <Button variant="outline" onClick={() => apply(DEFAULT_FILTERS)}>
                {t("filters.clear")}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<ListChecksIcon />}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        )
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(({ group, items }) => (
            <GroupSection key={group} group={group} count={items.length}>
              {items.map((item) =>
                item.kind === "crm" ? (
                  <TaskRow
                    key={item.key}
                    task={item.task}
                    now={now}
                    showOrigin={Boolean(worker)}
                    onOpen={actions.open}
                    onComplete={actions.complete}
                    onReopen={actions.reopen}
                  />
                ) : (
                  <OwnerTaskRow
                    key={item.key}
                    task={item.task}
                    onToggle={(task) =>
                      setOwnerStatus.mutate({
                        id: task.id,
                        status: task.status === "done" ? "todo" : "done",
                      })
                    }
                  />
                ),
              )}
            </GroupSection>
          ))}
          {wantsOpen && (open.data?.length ?? 0) >= OPEN_LIMIT && (
            <p className="text-sm text-ink-muted">
              {t("limited", { count: formatNumber(OPEN_LIMIT, {}, settings) })}
            </p>
          )}

          {doneTotal > 0 && (
            <section aria-labelledby="crm-tasks-done" className="flex flex-col gap-2">
              <h2 id="crm-tasks-done">
                <button
                  type="button"
                  aria-expanded={showDone}
                  aria-controls="crm-tasks-done-list"
                  onClick={() => setShowDone((value) => !value)}
                  className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8"
                >
                  <ChevronDownIcon
                    aria-hidden
                    className={cn(
                      "size-4 text-ink-muted transition-transform",
                      !showDone && "-rotate-90",
                    )}
                  />
                  <span className="micro-label">{t("groups.done")}</span>
                  <span className="text-xs text-ink-muted tabular-nums">
                    {formatNumber(doneTotal, {}, settings)}
                  </span>
                </button>
              </h2>
              {showDone && (
                <div id="crm-tasks-done-list" className="flex flex-col gap-2">
                  <ul className="flex flex-col gap-2">
                    {doneCrm.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        now={now}
                        showOrigin={Boolean(worker)}
                        onOpen={actions.open}
                        onComplete={actions.complete}
                        onReopen={actions.reopen}
                      />
                    ))}
                  </ul>
                  <Pager
                    page={donePage}
                    pages={Math.max(1, Math.ceil((done.data?.total ?? 0) / DONE_PAGE_SIZE))}
                    onPage={setDonePage}
                  />
                  {doneOwner.length > 0 && (
                    <ul className="flex flex-col gap-2">
                      {doneOwner.map((task) => (
                        <OwnerTaskRow
                          key={task.id}
                          task={task}
                          onToggle={(item) =>
                            setOwnerStatus.mutate({ id: item.id, status: "todo" })
                          }
                        />
                      ))}
                    </ul>
                  )}
                  {worker && (
                    <Pager
                      page={ownerDonePage}
                      pages={Math.max(1, Math.ceil((ownerDone.data?.total ?? 0) / OWNER_PAGE_SIZE))}
                      onPage={setOwnerDonePage}
                    />
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <TaskDialog
        open={adding}
        onOpenChange={setAdding}
        target={{ deal: null, contact: null }}
        origin="tasks"
      />
      {actions.dialogs}
    </div>
  );
}

const GROUP_TONE: Partial<Record<TaskGroup, string>> = { overdue: "text-pink" };

function GroupSection({
  group,
  count,
  children,
}: {
  group: TaskGroup;
  count: number;
  children: ReactNode;
}) {
  const t = useTranslations("crmTasks.groups");
  const settings = useFormatSettings();
  const id = `crm-tasks-${group}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="flex items-center gap-1.5">
        <span className={cn("micro-label", GROUP_TONE[group])}>{t(group)}</span>
        <span className="text-xs text-ink-muted tabular-nums">
          {formatNumber(count, {}, settings)}
        </span>
      </h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}
