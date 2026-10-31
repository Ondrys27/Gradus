"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CheckCircle2Icon,
  ContactRoundIcon,
  HandshakeIcon,
  PencilIcon,
  PlusCircleIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { useWorkspace } from "@/features/account/workspace-queries";
import { contactName } from "@/features/contacts/types";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { canEditTask, canTickTask } from "./access";
import { isOverdue } from "./logic";
import { useDeleteTask, useReopenTask } from "./queries";
import { crmTiming } from "./timing";
import { contactHref, dealHref, type CrmTask } from "./types";
import { useAssigneeName } from "./use-assignee-name";

type Props = {
  task: CrmTask | null;
  now: Date;
  onClose: () => void;
  onEdit: (task: CrmTask) => void;
  onComplete: (task: CrmTask) => void;
};

/** A task opened from a list: what, when, for how long, who, and what happened to it. */
export function TaskDetailDialog({ task, now, onClose, onEdit, onComplete }: Props) {
  const t = useTranslations("crmTasks.detail");
  // Keep the last task on screen while the dialog closes.
  const [shown, setShown] = useState<CrmTask | null>(task);
  if (task && task !== shown) setShown(task);
  const current = task ?? shown;
  return (
    <ResponsiveDialog
      open={task !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,520px)]"
    >
      {current && (
        <Body
          key={current.id}
          task={current}
          now={now}
          onClose={onClose}
          onEdit={onEdit}
          onComplete={onComplete}
        />
      )}
    </ResponsiveDialog>
  );
}

function Body({
  task,
  now,
  onClose,
  onEdit,
  onComplete,
}: {
  task: CrmTask;
  now: Date;
  onClose: () => void;
  onEdit: (task: CrmTask) => void;
  onComplete: (task: CrmTask) => void;
}) {
  const t = useTranslations("crmTasks.detail");
  const tRow = useTranslations("crmTasks.row");
  const locale = useLocale();
  const settings = useFormatSettings();
  const workspace = useWorkspace();
  const nameOf = useAssigneeName();
  const reopen = useReopenTask();
  const remove = useDeleteTask();
  const [confirming, setConfirming] = useState(false);
  const done = task.status === "done";
  const overdue = isOverdue(crmTiming(task), now, settings);
  const due = new Date(task.due_at);
  const canEdit = canEditTask(workspace, task);
  const canTick = canTickTask(workspace, task);

  async function confirmDelete() {
    try {
      await remove.mutateAsync(task.id);
      setConfirming(false);
      onClose();
    } catch {
      // The confirmation shows the error and stays open.
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-ink [overflow-wrap:anywhere]">{task.title}</h3>
        <div className="flex flex-wrap gap-1.5">
          {done ? (
            <StatusPill tone="green">{t("statusDone")}</StatusPill>
          ) : overdue ? (
            <StatusPill tone="pink">{tRow("overdue")}</StatusPill>
          ) : (
            <StatusPill tone="neutral">{t("statusOpen")}</StatusPill>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <Fact label={t("due")}>
          <span className={overdue ? "text-pink" : undefined}>
            {tRow("due", {
              date: formatDateTime(due, settings),
              relative: formatRelativeTime(due, now, locale),
            })}
          </span>
        </Fact>
        <Fact label={t("duration")}>
          {tRow("minutes", { count: formatNumber(task.duration_minutes, {}, settings) })}
        </Fact>
        <Fact label={t("assignee")}>
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={nameOf(task.assignee_id)} className="size-5 text-[9px]" />
            {nameOf(task.assignee_id)}
          </span>
        </Fact>
        {task.deal && (
          <Fact label={t("deal")}>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <HandshakeIcon aria-hidden className="size-4 shrink-0 text-gold" />
              <span className="truncate">{task.deal.title}</span>
            </span>
          </Fact>
        )}
        {task.contact && (
          <Fact label={t("contact")}>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <ContactRoundIcon aria-hidden className="size-4 shrink-0 text-teal" />
              <span className="truncate">{contactName(task.contact)}</span>
            </span>
          </Fact>
        )}
      </dl>

      <section aria-labelledby="crm-task-description" className="flex flex-col gap-1.5">
        <h4 id="crm-task-description" className="micro-label">
          {t("description")}
        </h4>
        <p className="text-sm whitespace-pre-line text-ink-soft [overflow-wrap:anywhere]">
          {task.description || t("noDescription")}
        </p>
      </section>

      <section aria-labelledby="crm-task-history" className="flex flex-col gap-1.5">
        <h4 id="crm-task-history" className="micro-label">
          {t("history")}
        </h4>
        <ol className="flex flex-col">
          {done && task.completed_at && (
            <HistoryItem
              icon={<CheckCircle2Icon aria-hidden className="size-4 text-green" />}
              title={t("historyDone", { name: nameOf(task.completed_by) })}
              at={task.completed_at}
              note={task.completion_note}
            />
          )}
          <HistoryItem
            icon={<PlusCircleIcon aria-hidden className="size-4" />}
            title={t("historyCreated", { name: nameOf(task.created_by) })}
            at={task.created_at}
          />
        </ol>
      </section>

      {(task.deal || task.contact) && (
        <div className="flex flex-wrap gap-2">
          {task.deal && (
            <Link
              href={dealHref(task.deal.id)}
              onClick={onClose}
              className={buttonVariants({ variant: "secondary" })}
            >
              <HandshakeIcon aria-hidden data-icon="inline-start" />
              {t("openDeal")}
            </Link>
          )}
          {task.contact && (
            <Link
              href={contactHref(task.contact.id)}
              onClick={onClose}
              className={buttonVariants({ variant: "secondary" })}
            >
              <ContactRoundIcon aria-hidden data-icon="inline-start" />
              {t("openContact")}
            </Link>
          )}
        </div>
      )}

      {reopen.isError && <FormAlert>{t("reopenFailed")}</FormAlert>}
      {(canTick || canEdit) && (
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
          {canEdit && (
            <Button
              type="button"
              variant="destructive"
              className="sm:mr-auto"
              onClick={() => setConfirming(true)}
            >
              <Trash2Icon aria-hidden data-icon="inline-start" />
              {t("delete")}
            </Button>
          )}
          {canEdit && (
            <Button type="button" variant="outline" onClick={() => onEdit(task)}>
              <PencilIcon aria-hidden data-icon="inline-start" />
              {t("edit")}
            </Button>
          )}
          {canTick &&
            (done ? (
              <Button
                type="button"
                variant="outline"
                disabled={reopen.isPending}
                onClick={() => reopen.mutate(task.id, { onSuccess: onClose })}
              >
                <RotateCcwIcon aria-hidden data-icon="inline-start" />
                {t("reopen")}
              </Button>
            ) : (
              <Button type="button" onClick={() => onComplete(task)}>
                <CheckCircle2Icon aria-hidden data-icon="inline-start" />
                {t("markDone")}
              </Button>
            ))}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("deleteTitle")}
        description={t("deleteDescription", { title: task.title })}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={remove.isPending}
        error={remove.isError ? t("deleteFailed") : null}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </>
  );
}

function HistoryItem({
  icon,
  title,
  at,
  note,
}: {
  icon: ReactNode;
  title: string;
  at: string;
  note?: string | null;
}) {
  const settings = useFormatSettings();
  return (
    <li className="flex gap-3 border-b border-line/60 py-2.5 last:border-b-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line bg-surface-hover text-ink-soft">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium text-ink">{title}</span>
          <time dateTime={at} className="text-xs text-ink-muted">
            {formatDateTime(new Date(at), settings)}
          </time>
        </p>
        {note && (
          <p className="text-sm whitespace-pre-line text-ink-soft [overflow-wrap:anywhere]">
            {note}
          </p>
        )}
      </div>
    </li>
  );
}
