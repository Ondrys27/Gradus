"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  CalendarClockIcon,
  ContactRoundIcon,
  HandshakeIcon,
  MessageSquareTextIcon,
  TimerIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusPill } from "@/components/ui/status-pill";
import { useWorkspace } from "@/features/account/workspace-queries";
import { contactName } from "@/features/contacts/types";
import type { WorkerTask } from "@/features/workers/types";
import {
  formatCalendarDate,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  todayIsoDate,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { canTickTask } from "./access";
import { isOverdue } from "./logic";
import { contactHref, dealHref, type CrmTask } from "./types";
import { useAssigneeName } from "./use-assignee-name";
import { crmTiming } from "./timing";

type Props = {
  task: CrmTask;
  now: Date;
  /** Opens the dialog of the note; reopening happens at once. */
  onComplete: (task: CrmTask) => void;
  onReopen: (task: CrmTask) => void;
  onOpen: (task: CrmTask) => void;
  /** A worker's list mixes in the owner's tasks, so every row says where it comes from. */
  showOrigin?: boolean;
  /** Inside a deal or a contact: the link back to it is left out. */
  hideTarget?: "deal" | "contact";
};

/** One sales task: tick, title, what it belongs to, due, length and who does it. */
export function TaskRow({
  task,
  now,
  onComplete,
  onReopen,
  onOpen,
  showOrigin,
  hideTarget,
}: Props) {
  const t = useTranslations("crmTasks.row");
  const tOrigin = useTranslations("crmTasks.origin");
  const locale = useLocale();
  const settings = useFormatSettings();
  const workspace = useWorkspace();
  const nameOf = useAssigneeName();
  const reduceMotion = useReducedMotion();
  const [pops, setPops] = useState(0);
  const done = task.status === "done";
  const overdue = isOverdue(crmTiming(task), now, settings);
  const due = new Date(task.due_at);
  const canTick = canTickTask(workspace, task);
  const who = nameOf(task.assignee_id);

  return (
    <li className="flex items-start gap-3 rounded-2xl border border-line bg-surface/70 px-4 py-3">
      <motion.span
        key={pops}
        initial={pops > 0 && !reduceMotion ? { scale: 0.7 } : false}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 18 }}
        className="flex pt-0.5"
      >
        <Checkbox
          checked={done}
          disabled={!canTick}
          aria-label={
            done ? t("reopen", { title: task.title }) : t("complete", { title: task.title })
          }
          onCheckedChange={() => {
            if (done) {
              onReopen(task);
            } else {
              setPops((count) => count + 1);
              onComplete(task);
            }
          }}
        />
      </motion.span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <button
          type="button"
          onClick={() => onOpen(task)}
          aria-label={t("open", { title: task.title })}
          className={cn(
            "-my-1 min-h-11 cursor-pointer rounded-lg py-1 text-left text-sm font-medium text-ink outline-none [overflow-wrap:anywhere] hover:text-violet focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-0",
            done && "text-ink-soft line-through decoration-ink-muted/60",
          )}
        >
          {task.title}
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {showOrigin && <StatusPill tone="violet">{tOrigin("crm")}</StatusPill>}
          {task.deal && hideTarget !== "deal" && (
            <Link
              href={dealHref(task.deal.id)}
              className="inline-flex min-h-11 max-w-full items-center gap-1 text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-0"
            >
              <HandshakeIcon aria-hidden className="size-3.5 shrink-0 text-gold" />
              <span className="truncate">{task.deal.title}</span>
            </Link>
          )}
          {task.contact && hideTarget !== "contact" && (
            <Link
              href={contactHref(task.contact.id)}
              className="inline-flex min-h-11 max-w-full items-center gap-1 text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-0"
            >
              <ContactRoundIcon aria-hidden className="size-3.5 shrink-0 text-teal" />
              <span className="truncate">{contactName(task.contact)}</span>
            </Link>
          )}
          <span className={cn("inline-flex items-center gap-1", overdue && "text-pink")}>
            <CalendarClockIcon aria-hidden className="size-3.5 shrink-0" />
            <time dateTime={task.due_at}>
              {t("due", {
                date: formatDateTime(due, settings),
                relative: formatRelativeTime(due, now, locale),
              })}
            </time>
          </span>
          {overdue && <StatusPill tone="pink">{t("overdue")}</StatusPill>}
          <span className="inline-flex items-center gap-1">
            <TimerIcon aria-hidden className="size-3.5 shrink-0" />
            {t("minutes", { count: formatNumber(task.duration_minutes, {}, settings) })}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={who} className="size-5 text-[9px]" />
            {who}
          </span>
          {done && task.completed_at && (
            <span>
              {t("completedOn", { date: formatDate(new Date(task.completed_at), settings) })}
            </span>
          )}
        </div>
        {done && task.completion_note && (
          <p className="flex gap-1.5 text-xs whitespace-pre-line text-ink-soft [overflow-wrap:anywhere]">
            <MessageSquareTextIcon aria-hidden className="mt-px size-3.5 shrink-0" />
            {task.completion_note}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * A task the owner gave the worker in Workers, in the same list: a day
 * without a time, ticked off at once (no note), marked where it comes from.
 */
export function OwnerTaskRow({
  task,
  onToggle,
}: {
  task: WorkerTask;
  onToggle: (task: WorkerTask) => void;
}) {
  const t = useTranslations("crmTasks.row");
  const tOrigin = useTranslations("crmTasks.origin");
  const settings = useFormatSettings();
  const workspace = useWorkspace();
  const reduceMotion = useReducedMotion();
  const [pops, setPops] = useState(0);
  const done = task.status === "done";
  const overdue = !done && task.due_date !== null && task.due_date < todayIsoDate(settings);

  return (
    <li className="flex items-start gap-3 rounded-2xl border border-line bg-surface/70 px-4 py-3">
      <motion.span
        key={pops}
        initial={pops > 0 && !reduceMotion ? { scale: 0.7 } : false}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 18 }}
        className="flex pt-0.5"
      >
        <Checkbox
          checked={done}
          disabled={workspace.readOnly}
          aria-label={
            done ? t("reopen", { title: task.title }) : t("complete", { title: task.title })
          }
          onCheckedChange={() => {
            if (!done) setPops((count) => count + 1);
            onToggle(task);
          }}
        />
      </motion.span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span
          className={cn(
            "text-sm font-medium text-ink [overflow-wrap:anywhere]",
            done && "text-ink-soft line-through decoration-ink-muted/60",
          )}
        >
          {task.title}
        </span>
        {task.description && (
          <span className="text-xs whitespace-pre-line text-ink-soft [overflow-wrap:anywhere]">
            {task.description}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <StatusPill tone="teal">{tOrigin("owner")}</StatusPill>
          {task.due_date && (
            <span className={cn("inline-flex items-center gap-1", overdue && "text-pink")}>
              <CalendarClockIcon aria-hidden className="size-3.5 shrink-0" />
              {t("dueDay", { date: formatCalendarDate(task.due_date, settings) })}
            </span>
          )}
          {overdue && <StatusPill tone="pink">{t("overdue")}</StatusPill>}
          {done && task.completed_at && (
            <span>
              {t("completedOn", { date: formatDate(new Date(task.completed_at), settings) })}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
