"use client";

import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { motion } from "framer-motion";
import { LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";

type TaskCheckboxProps = {
  title: string;
  done: boolean;
  /** Open direct subtasks. While there are any, the task cannot be ticked. */
  remaining: number;
  onToggle: () => void;
};

export function TaskCheckbox({ title, done, remaining, onToggle }: TaskCheckboxProps) {
  const t = useTranslations("milestones.tasks");
  const locked = remaining > 0;

  // Play the unlock animation when the last open subtask gets done (state adjusted while rendering).
  const [wasLocked, setWasLocked] = useState(locked);
  const [unlocks, setUnlocks] = useState(0);
  if (locked !== wasLocked) {
    setWasLocked(locked);
    if (!locked) setUnlocks((count) => count + 1);
  }

  if (locked) {
    return (
      <Popover.Root>
        <Popover.Trigger
          openOnHover
          delay={100}
          aria-label={t("lockedLabel", { title })}
          className="relative grid size-5.5 shrink-0 cursor-not-allowed place-items-center rounded-md border-2 border-line bg-canvas-deep/40 text-ink-muted outline-none after:absolute after:-inset-3 after:content-[''] focus-visible:ring-3 focus-visible:ring-violet/30"
        >
          <LockIcon aria-hidden className="size-3" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={8} className="z-popover">
            <Popover.Popup className="max-w-64 rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink-soft shadow-popover outline-none">
              {t("lockedHint", { count: remaining })}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <motion.span
      key={unlocks}
      className="relative grid shrink-0 place-items-center"
      initial={unlocks > 0 ? { scale: 0.5, rotate: -25 } : false}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 16 }}
    >
      {unlocks > 0 && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute size-5.5 rounded-md border-2 border-teal"
          initial={{ opacity: 0.8, scale: 1 }}
          animate={{ opacity: 0, scale: 2.4 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      )}
      <Checkbox
        checked={done}
        onCheckedChange={onToggle}
        aria-label={done ? t("checkReopen", { title }) : t("checkDone", { title })}
      />
    </motion.span>
  );
}
