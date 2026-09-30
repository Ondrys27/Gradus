"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckIcon, ChevronDownIcon, LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { TASK_VISUAL_STATES, taskStateChipClass, type TaskVisualState } from "./task-status";
import type { TaskStatus } from "./types";

/** Small pill with the state's colour, used in the list. */
export function TaskStatePill({ state }: { state: TaskVisualState }) {
  const t = useTranslations("milestones.tasks.state");
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap",
        taskStateChipClass[state],
      )}
    >
      <StateMark state={state} />
      {t(state)}
    </span>
  );
}

/** Days past the due date: a small pink label, the same on the map and in the list. */
export function OverdueBadge({ days, className }: { days: number; className?: string }) {
  const t = useTranslations("milestones.tasks");
  return (
    <span
      title={t("overdueDays", { days })}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-pink/40 bg-pink/15 px-1.5 text-[11px] font-semibold text-pink tabular-nums",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-pink" />
      <span aria-hidden>{t("overdueBadge", { days })}</span>
      <span className="sr-only">{t("overdueDays", { days })}</span>
    </span>
  );
}

/** A miniature of how each state looks on the map. */
function StateMark({ state }: { state: TaskVisualState }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid size-3.5 shrink-0 place-items-center rounded-[5px] border-[1.5px]",
        state === "todo" && "border-line-strong",
        state === "in_progress" && "border-orange shadow-[0_0_8px_-1px_var(--color-orange)]",
        state === "done" && "border-teal bg-teal text-canvas",
        state === "locked" && "border-line bg-surface-hover text-ink-muted",
      )}
    >
      {state === "done" && <CheckIcon className="size-2.5" strokeWidth={4} />}
      {state === "locked" && <LockIcon className="size-2" strokeWidth={3} />}
    </span>
  );
}

/** Top-left corner of the map: what each look means. Starts folded on a phone. */
export function TaskStateLegend() {
  const t = useTranslations("milestones");
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(
    () => typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches,
  );

  return (
    <div className="rounded-2xl border border-line/70 bg-surface/85 shadow-popover backdrop-blur-xl">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? t("map.legendHide") : t("map.legendShow")}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-2xl px-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8"
      >
        <span className="micro-label">{t("map.legend")}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "ml-auto size-3.5 text-ink-muted transition-transform motion-reduce:transition-none",
            !open && "-rotate-90",
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
            className="flex flex-col gap-1.5 overflow-hidden px-3 pb-2.5"
          >
            {TASK_VISUAL_STATES.map((state) => (
              <li key={state} className="flex items-center gap-2 text-xs text-ink-soft">
                <StateMark state={state} />
                {t(`tasks.state.${state}`)}
              </li>
            ))}
            <li className="flex items-center gap-2 text-xs text-ink-soft">
              <span aria-hidden className="grid size-3.5 place-items-center">
                <span className="size-2 rounded-full bg-pink" />
              </span>
              {t("tasks.state.overdue")}
            </li>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

const SWITCH_STATES: TaskStatus[] = ["todo", "in_progress", "done"];

/** The three statuses side by side in their colours; done is locked while subtasks are open. */
export function TaskStatusSwitch({
  id,
  value,
  locked,
  onChange,
}: {
  id: string;
  value: TaskStatus;
  locked: boolean;
  onChange: (status: TaskStatus) => void;
}) {
  const t = useTranslations("milestones.tasks");
  const selected: Record<TaskStatus, string> = {
    todo: "border-line-strong bg-surface-hover text-ink",
    in_progress: "border-orange/60 bg-orange/12 text-orange",
    done: "border-teal/60 bg-teal/12 text-teal",
  };

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={t("form.statusGroup")}
      className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-canvas-deep/40 p-1"
    >
      {SWITCH_STATES.map((status) => {
        const disabled = status === "done" && locked;
        const checked = value === status;
        return (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(status)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border border-transparent px-2 text-sm font-medium text-ink-muted transition-colors outline-none focus-visible:ring-3 focus-visible:ring-violet/40 disabled:cursor-not-allowed disabled:opacity-50 mouse:min-h-9",
              !checked && !disabled && "hover:text-ink",
              checked && selected[status],
            )}
          >
            {disabled ? (
              <LockIcon aria-hidden className="size-3.5" />
            ) : (
              <StateMark state={status} />
            )}
            <span className="truncate">{t(`state.${status}`)}</span>
          </button>
        );
      })}
    </div>
  );
}
