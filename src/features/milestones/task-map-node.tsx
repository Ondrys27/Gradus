"use client";

import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeftIcon, FlagIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatNumber, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { TaskCheckbox } from "./task-checkbox";
import { overdueDays, taskCardClass, taskVisualState } from "./task-status";
import { OverdueBadge } from "./task-status-ui";
import type { Task } from "./types";

/** Shared by the visible node and its hidden twin in the measuring layer. */
const cardBase =
  "relative flex w-max max-w-[260px] min-w-[140px] items-start gap-2.5 rounded-2xl border px-3 py-2.5 text-left";

/** A tap that moved further than this was a pan, not a tap. */
const TAP_SLOP = 8;

const stop = (event: MouseEvent | PointerEvent) => event.stopPropagation();

/** Small round control on a node; the ::after keeps the touch target at 44 px. */
const miniButton =
  "relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted outline-none after:absolute after:-inset-2 after:content-[''] hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40";

export type TaskMapNodeProps = {
  task: Task;
  /** Open direct subtasks; while above zero the task is locked. */
  remaining: number;
  childCount: number;
  hiddenCount: number;
  collapsed: boolean;
  onOpen: () => void;
  onToggleDone: () => void;
  /** Absent when the account may not add tasks. */
  onAddChild?: () => void;
  onToggleCollapsed: () => void;
  readOnly?: boolean;
};

export function TaskMapNode({
  task,
  remaining,
  childCount,
  hiddenCount,
  collapsed,
  onOpen,
  onToggleDone,
  onAddChild,
  onToggleCollapsed,
  readOnly = false,
}: TaskMapNodeProps) {
  const t = useTranslations("milestones");
  const settings = useFormatSettings();
  const reduceMotion = useReducedMotion();
  const done = task.status === "done";
  const locked = remaining > 0;
  const state = taskVisualState(task, remaining);
  const late = overdueDays(task, todayIsoDate(settings));
  const pressedAt = useRef<{ x: number; y: number } | null>(null);

  // When the last subtask gets done the node unlocks with a pulse and waits for a manual tick.
  const [wasLocked, setWasLocked] = useState(locked);
  const [unlocks, setUnlocks] = useState(0);
  if (locked !== wasLocked) {
    setWasLocked(locked);
    if (!locked) setUnlocks((count) => count + 1);
  }

  function open(event: MouseEvent) {
    const start = pressedAt.current;
    pressedAt.current = null;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) return;
    onOpen();
  }

  return (
    <div
      data-state={state}
      title={locked ? t("tasks.lockedHint", { count: remaining }) : undefined}
      onPointerDown={(event) => (pressedAt.current = { x: event.clientX, y: event.clientY })}
      onClick={open}
      className={cn(
        cardBase,
        "group cursor-pointer transition-[border-color,background-color,opacity,box-shadow] duration-300",
        taskCardClass[state],
      )}
    >
      {late > 0 && <OverdueBadge days={late} className="absolute -top-2.5 right-3 z-10" />}
      {unlocks > 0 && !reduceMotion && (
        <motion.span
          key={unlocks}
          aria-hidden
          className="pointer-events-none absolute -inset-px rounded-2xl border-2 border-teal"
          initial={{ opacity: 0.9, scale: 1 }}
          animate={{ opacity: 0, scale: 1.12 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      )}

      <span className="mt-0.5 flex shrink-0" onClick={stop} onPointerDown={stop}>
        <TaskCheckbox
          title={task.title}
          done={done}
          inProgress={state === "in_progress"}
          remaining={remaining}
          disabled={readOnly}
          onToggle={onToggleDone}
        />
      </span>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          open(event);
        }}
        aria-label={t("map.open", { title: task.title })}
        className={cn(
          "min-w-0 flex-1 cursor-pointer self-stretch rounded-md text-left text-sm leading-snug [overflow-wrap:anywhere] text-ink outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
          done && "text-ink-soft",
          locked && "text-ink-muted",
        )}
      >
        {task.title}
      </button>

      {onAddChild && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAddChild();
          }}
          aria-label={t("map.addChild", { title: task.title })}
          className={cn(
            miniButton,
            "-my-1 -mr-1.5 mouse:opacity-0 mouse:group-focus-within:opacity-100 mouse:group-hover:opacity-100",
          )}
        >
          <PlusIcon aria-hidden className="size-4" />
        </button>
      )}

      {childCount > 0 && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapsed();
          }}
          onPointerDown={stop}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("map.expand", { count: hiddenCount }) : t("map.collapse")}
          className={cn(
            "absolute top-1/2 left-full z-10 grid h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border bg-canvas-deep px-1 text-[11px] font-semibold text-ink-soft tabular-nums outline-none after:absolute after:-inset-2.5 after:content-[''] hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40",
            collapsed ? "border-violet text-ink" : "border-line-strong",
          )}
        >
          {collapsed ? (
            `+${formatNumber(hiddenCount, {}, settings)}`
          ) : (
            <ChevronLeftIcon aria-hidden className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

type RootProps = {
  title: string;
  done: number;
  total: number;
  completed: boolean;
  onAddChild?: () => void;
};

/** The milestone itself, at the root of the tree. */
export function TaskMapRoot({ title, done, total, completed, onAddChild }: RootProps) {
  const t = useTranslations("milestones");
  const settings = useFormatSettings();
  const ratio = total > 0 ? done / total : 0;

  return (
    <div
      className={cn(
        cardBase,
        "flex-col gap-2 border-violet bg-[color-mix(in_oklab,var(--color-violet)_18%,var(--color-surface))] shadow-glow-strong",
        completed && "border-green",
      )}
    >
      <div className="flex w-full items-start gap-2.5">
        <FlagIcon
          aria-hidden
          className={cn("mt-0.5 size-4 shrink-0", completed ? "text-green" : "text-gold")}
        />
        <span className="min-w-0 flex-1 text-[15px] leading-snug font-semibold [overflow-wrap:anywhere] text-ink">
          {title}
        </span>
        {onAddChild && (
          <button
            type="button"
            onClick={onAddChild}
            aria-label={t("map.addTask")}
            className={cn(miniButton, "-my-1 -mr-1.5")}
          >
            <PlusIcon aria-hidden className="size-4" />
          </button>
        )}
      </div>
      <div className="flex w-full items-center gap-2">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/60">
          <span
            className="block h-full rounded-full bg-teal transition-[width] duration-500"
            style={{ width: `${ratio * 100}%` }}
          />
        </span>
        <span className="text-xs text-ink-soft tabular-nums">
          {t("map.rootProgress", {
            done: formatNumber(done, {}, settings),
            total: formatNumber(total, {}, settings),
          })}
        </span>
      </div>
    </div>
  );
}
