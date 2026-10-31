"use client";

import { useEffect, useState } from "react";
import { CompleteTaskDialog } from "./complete-dialog";
import { useReopenTask } from "./queries";
import { TaskDetailDialog } from "./task-detail";
import { TaskDialog } from "./task-dialog";
import type { CrmTask } from "./types";

/** The clock of the lists, so "overdue" turns on by itself at the minute it is due. */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return now;
}

/**
 * The dialogs around a list of tasks — detail, edit, done with a note — and
 * reopening, the same in the Tasks section, a deal, a contact and the calendar.
 */
export function useTaskDialogs(now: Date) {
  const [detail, setDetail] = useState<CrmTask | null>(null);
  const [editing, setEditing] = useState<CrmTask | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [completing, setCompleting] = useState<CrmTask | null>(null);
  const reopen = useReopenTask();

  const dialogs = (
    <>
      <TaskDetailDialog
        task={detail}
        now={now}
        onClose={() => setDetail(null)}
        onEdit={(task) => {
          setDetail(null);
          setEditing(task);
          setEditOpen(true);
        }}
        onComplete={(task) => {
          setDetail(null);
          setCompleting(task);
        }}
      />
      <TaskDialog open={editOpen} onOpenChange={setEditOpen} task={editing} origin="tasks" />
      <CompleteTaskDialog task={completing} onClose={() => setCompleting(null)} />
    </>
  );

  return {
    open: setDetail,
    complete: setCompleting,
    reopen: (task: CrmTask) => reopen.mutate(task.id),
    reopenFailed: reopen.isError,
    dialogs,
  };
}
