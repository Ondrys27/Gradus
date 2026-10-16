"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { track } from "@/lib/analytics/client";
import type { OnboardingStep } from "./types";
import {
  completeStep,
  nextStep,
  parseDraft,
  previousStep,
  resolveStep,
  STEP_PARAM,
  STEP_SLUGS,
  stepFromSlug,
  stepIndex,
  type WizardDraft,
  type WizardStep,
} from "./wizard-state";

/** Answers stay in this browser until the wizard is finished; sign-out clears `gradus.*`. */
function storageKey(userId: string) {
  return `gradus.onboarding.${userId}`;
}

function readDraft(userId: string): WizardDraft {
  try {
    return parseDraft(window.localStorage.getItem(storageKey(userId)));
  } catch {
    return parseDraft(null);
  }
}

function writeDraft(userId: string, draft: WizardDraft | null) {
  try {
    if (draft) window.localStorage.setItem(storageKey(userId), JSON.stringify(draft));
    else window.localStorage.removeItem(storageKey(userId));
  } catch {
    // Blocked storage: the answers just do not survive a reload.
  }
}

/** Left on each history entry a Continue adds: the step of the entry below it. */
const HISTORY_MARK = "gradusWizardFrom";
type WizardHistoryMark = { [HISTORY_MARK]?: string };

/** The current address with the step set (or removed). */
function addressWith(step: WizardStep | null) {
  const url = new URL(window.location.href);
  if (step) url.searchParams.set(STEP_PARAM, STEP_SLUGS[step]);
  else url.searchParams.delete(STEP_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The wizard's position and answers. The step is read from the address, so
 * every Continue adds a history entry and the browser's Back returns one
 * step instead of leaving the app; a reload stays put. A step the account
 * has no right to yet is replaced by the first unfinished one, quietly.
 *
 * `history.pushState`/`replaceState` are the ones Next.js keeps in sync with
 * `useSearchParams`, without a server round trip.
 */
export function useWizard(userId: string) {
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<WizardDraft>(() => readDraft(userId));
  const requested = stepFromSlug(searchParams.get(STEP_PARAM));
  const step = resolveStep(requested, draft);

  /** Set once the wizard is finished, so nothing writes the step or the draft back. */
  const finished = useRef(false);

  useEffect(() => {
    if (!finished.current) writeDraft(userId, draft);
  }, [userId, draft]);

  // A missing, unknown or not-yet-allowed step in the address: show the right one.
  useEffect(() => {
    if (!finished.current && requested !== step) {
      window.history.replaceState(null, "", addressWith(step));
    }
  }, [requested, step]);

  /**
   * The Back button uses the browser's own Back when the history entry below
   * is the previous step, so the history stays one straight line; otherwise
   * (say, the wizard was opened at this step directly) it replaces the entry.
   * The entry below is known from the mark every Continue leaves on the entry
   * it adds (it survives a reload) and, as a fallback, from this trail of the
   * entries seen since the wizard opened.
   */
  const trail = useRef<{ steps: WizardStep[]; at: number }>({ steps: [], at: -1 });
  const lastStep = useRef<WizardStep | null>(null);
  const backVia = useRef<"button" | null>(null);

  useEffect(() => {
    const t = trail.current;
    if (t.steps[t.at] !== step) {
      if (t.at > 0 && t.steps[t.at - 1] === step) t.at -= 1;
      else if (t.steps[t.at + 1] === step) t.at += 1;
      else trail.current = { steps: [step], at: 0 };
    }
    const from = lastStep.current;
    lastStep.current = step;
    if (from && from !== step) {
      const fromIndex = stepIndex(from, draft.mode);
      const toIndex = stepIndex(step, draft.mode);
      if (step !== "closing" && fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex) {
        track("onboarding_step_back", { step: from, to: step, via: backVia.current ?? "browser" });
      }
    }
    backVia.current = null;
    // Only a change of step matters; the mode is read as it is at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  /**
   * Finishes the current step and moves on. The draft is updated first so the
   * next step is already allowed when the address changes. Only the first
   * completion of a step is recorded.
   */
  const advance = useCallback(
    (update: (draft: WizardDraft) => WizardDraft = (d) => d) => {
      if (step === "closing") return;
      const current: OnboardingStep = step;
      const updated = update(draft);
      const { draft: completed, first } = completeStep(updated, current);
      if (first) {
        track("onboarding_step_completed", {
          step: current,
          index: stepIndex(current, completed.mode),
          ...(current === "mode" && completed.mode ? { mode: completed.mode } : {}),
        });
      }
      setDraft(completed);
      const target = nextStep(current, completed.mode);
      const t = trail.current;
      trail.current = { steps: [...t.steps.slice(0, t.at + 1), target], at: t.at + 1 };
      const mark: WizardHistoryMark = { [HISTORY_MARK]: STEP_SLUGS[current] };
      window.history.pushState(mark, "", addressWith(target));
    },
    [draft, step],
  );

  /** The Back button: one step back, keeping every answer. */
  const back = useCallback(() => {
    const target = previousStep(step, draft.mode);
    if (!target) return;
    backVia.current = "button";
    const t = trail.current;
    const below = (window.history.state as WizardHistoryMark | null)?.[HISTORY_MARK];
    if (below === STEP_SLUGS[target] || (t.at > 0 && t.steps[t.at - 1] === target)) {
      window.history.back();
    } else {
      t.steps[t.at] = target;
      window.history.replaceState(null, "", addressWith(target));
    }
  }, [draft.mode, step]);

  /** Changes an answer without moving (picking a branch, a path). */
  const update = useCallback((change: (draft: WizardDraft) => WizardDraft) => {
    setDraft((current) => change(current));
  }, []);

  /** The wizard is done: forget the draft and take the step out of the address. */
  const clear = useCallback(() => {
    finished.current = true;
    writeDraft(userId, null);
    window.history.replaceState(null, "", addressWith(null));
  }, [userId]);

  return { step, draft, advance, back, update, clear };
}
