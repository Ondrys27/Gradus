"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2Icon, LockIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { MilestoneCompletion } from "./task-tree";

type Props = {
  completion: MilestoneCompletion;
  pending: boolean;
  onComplete: () => void;
  onReopen: () => void;
};

/**
 * Locked (muted, with a lock and how many tasks are left) until every task is
 * done; then it unlocks with a short animation and lights up. Completing is
 * always the user's tap, never automatic.
 */
export function CompleteMilestoneButton({ completion, pending, onComplete, onReopen }: Props) {
  const t = useTranslations("milestones.actions");
  const reduceMotion = useReducedMotion();
  const ready = completion.kind === "ready";

  // Unlocking is played only when it happens in front of the user.
  const [wasReady, setWasReady] = useState(ready);
  const [unlocks, setUnlocks] = useState(0);
  if (ready !== wasReady) {
    setWasReady(ready);
    if (ready) setUnlocks((count) => count + 1);
  }

  if (completion.kind === "completed") {
    return (
      <Button variant="outline" disabled={pending} onClick={onReopen}>
        <RotateCcwIcon aria-hidden data-icon="inline-start" />
        {t("reopen")}
      </Button>
    );
  }

  if (!ready) {
    const label =
      completion.kind === "empty"
        ? t("completeEmpty")
        : t("completeLocked", { count: completion.remaining });
    const hint = completion.kind === "empty" ? t("completeEmptyHint") : t("completeLockedHint");
    return (
      <Button
        variant="outline"
        disabled
        focusableWhenDisabled
        title={hint}
        aria-label={`${t("complete")}: ${label}. ${hint}`}
        className="cursor-not-allowed border-line bg-surface/60 text-ink-muted hover:bg-surface/60 hover:text-ink-muted"
      >
        <LockIcon aria-hidden data-icon="inline-start" />
        {label}
      </Button>
    );
  }

  const animate = unlocks > 0 && !reduceMotion;
  return (
    <motion.span
      key={unlocks}
      className="relative inline-flex"
      initial={animate ? { scale: 0.9 } : false}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 14 }}
    >
      {animate && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl border-2 border-gold"
          initial={{ opacity: 0.9, scale: 1 }}
          animate={{ opacity: 0, scale: 1.35 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      )}
      <Button
        disabled={pending}
        onClick={onComplete}
        className="bg-gold text-canvas shadow-[0_0_28px_-6px_var(--color-gold)] hover:bg-gold/90 hover:shadow-[0_0_36px_-4px_var(--color-gold)]"
      >
        <motion.span
          aria-hidden
          className="inline-flex"
          initial={animate ? { rotate: -90, scale: 0.4, opacity: 0 } : false}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 16, delay: animate ? 0.1 : 0 }}
        >
          <CheckCircle2Icon data-icon="inline-start" />
        </motion.span>
        {t("complete")}
      </Button>
    </motion.span>
  );
}
