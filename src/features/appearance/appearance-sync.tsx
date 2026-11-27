"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession, useUserSettings } from "@/features/account/queries";
import { coldCallingKeys } from "@/features/cold-calling/timer-queries";
import type { TimerReading } from "@/features/cold-calling/timer-logic";
import { gradyOverlay } from "@/features/grady/overlay-store";
import { anyLiveTyping } from "@/features/notes/collab/registry";
import { track } from "@/lib/analytics/client";
import { useAnimationsEnabled } from "@/lib/animation-preference";
import { isSoundEnabled } from "@/lib/sound-preference";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { applyView, viewKey } from "./apply-view";
import type { AppearanceView } from "./custom-tokens";
import { periodOf, resolveRef, type ResolvedRef, type ScheduleBlock } from "./schedule";
import { parseThemeRef } from "./theme-ref";
import { transitionDecision, witnessed, type GateState } from "./transition-gate";
import { TransitionOverlay, type TransitionPlan } from "./transition-overlay";
import { playPeriodTone } from "./transition-tone";
import { transitionPreview } from "./transition-store";
import { useViewFor } from "./use-appearance";

/** How often the clock is looked at besides the timer set for the next block. */
const CHECK_EVERY_MS = 20_000;
/** How often a waiting transition asks whether it may play. */
const GATE_EVERY_MS = 1_000;
/** A preview stays in the block's theme this long before the current one returns. */
const PREVIEW_HOLD_MS = 1_500;

type Pending = { block: ScheduleBlock; view: AppearanceView; dueAt: number };

function focusInField(): boolean {
  const element = document.activeElement as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && (element as HTMLInputElement).type !== "checkbox");
}

function dialogOpen(): boolean {
  return [...document.querySelectorAll<HTMLElement>("[role='dialog'], [role='alertdialog']")].some(
    (element) => element.getClientRects().length > 0,
  );
}

/**
 * Keeps <html> in the theme in charge (30.6): the manual pick, or the block
 * of the day's schedule in the user's zone. A change the user makes is shown
 * at once; a block that begins while the app is open and watched plays the
 * transition, waiting (at most 5 minutes) while the user types, a dialog is
 * open, the call timer runs, the tutorial or the showcase is on or someone
 * types in a live note; after that the theme changes quietly. The block that
 * began while the app was closed is already in the server's first paint.
 */
export function AppearanceSync() {
  const settings = useUserSettings();
  const { user, showcase } = useSession();
  const queryClient = useQueryClient();
  const { viewFor, key: accessKey } = useViewFor();
  const prefersReduced = useReducedMotionSafe();
  const animations = useAnimationsEnabled();
  const reduced = prefersReduced || !animations;
  const [plan, setPlan] = useState<(TransitionPlan & { preview: boolean; waited: number }) | null>(null);

  const appliedKey = useRef<string | null>(null);
  const lastCheck = useRef<number | null>(null);
  const pending = useRef<Pending | null>(null);
  const lastKeyAt = useRef<number | null>(null);
  const playing = useRef(false);
  const live = useRef({ settings, viewFor, reduced });
  live.current = { settings, viewFor, reduced };

  const target = useCallback((now: number): { resolved: ResolvedRef; view: AppearanceView | null } => {
    const resolved = resolveRef(live.current.settings, now);
    return { resolved, view: live.current.viewFor(resolved.ref) };
  }, []);

  const paint = useCallback((view: AppearanceView) => {
    applyView(view);
    appliedKey.current = viewKey(view);
  }, []);

  // A change of the settings, the custom themes or what is unlocked: shown at once, no transition.
  const appearanceKey = JSON.stringify([
    settings.theme,
    settings.custom_theme_id,
    settings.theme_schedule,
    settings.theme_override_until,
    settings.timezone,
    accessKey,
  ]);
  useEffect(() => {
    if (playing.current) return;
    const now = Date.now();
    const { view } = target(now);
    if (!view) return;
    pending.current = null;
    paint(view);
    lastCheck.current = now;
  }, [appearanceKey, target, paint]);

  const gateState = useCallback(
    (): GateState => ({
      focusInField: focusInField(),
      lastKeyAt: lastKeyAt.current,
      dialogOpen: dialogOpen(),
      timerRunning: queryClient.getQueryData<TimerReading>(coldCallingKeys.timer(user.id))?.running ?? false,
      tutorial: gradyOverlay.get().tourActive,
      liveNoteTyping: anyLiveTyping(),
      showcase: showcase === "stage" || document.documentElement.hasAttribute("data-showcase"),
      hidden: document.visibilityState !== "visible",
    }),
    [queryClient, user.id, showcase],
  );

  // The clock: a timer for the next block and a regular look (sleep, a changed zone).
  useEffect(() => {
    let nextTimer: number | null = null;
    const check = () => {
      if (playing.current) return;
      const now = Date.now();
      const { resolved, view } = target(now);
      const previousCheck = lastCheck.current;
      lastCheck.current = now;
      if (view && viewKey(view) !== appliedKey.current) {
        const boundary = resolved.source === "schedule" ? resolved.active.startedAt : null;
        if (resolved.source === "schedule" && boundary !== null && witnessed(boundary, previousCheck, now)) {
          pending.current = { block: resolved.active.block, view, dueAt: boundary };
        } else if (!pending.current) {
          paint(view);
        }
      } else if (view && pending.current && viewKey(pending.current.view) !== viewKey(view)) {
        pending.current = null;
      }
      schedule(resolved, now);
    };
    const schedule = (resolved: ResolvedRef, now: number) => {
      if (nextTimer !== null) window.clearTimeout(nextTimer);
      const next = resolved.source === "schedule" ? resolved.active.endsAt : resolved.until;
      if (next === null) return;
      nextTimer = window.setTimeout(check, Math.min(Math.max(next - now + 50, 50), 2_000_000_000));
    };
    check();
    const interval = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      if (nextTimer !== null) window.clearTimeout(nextTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [appearanceKey, target, paint]);

  // Typing: the last key pressed anywhere.
  useEffect(() => {
    const onKey = () => {
      lastKeyAt.current = Date.now();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("input", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("input", onKey, true);
    };
  }, []);

  // A waiting transition asks every second whether it may play.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const waiting = pending.current;
      if (!waiting || playing.current) return;
      const now = Date.now();
      const decision = transitionDecision(waiting.dueAt, now, gateState());
      if (decision === "wait") return;
      pending.current = null;
      const custom = parseThemeRef(waiting.block.theme)?.kind === "custom";
      const period = periodOf(waiting.block.start);
      const waited = Math.min(300, Math.max(0, Math.round((now - waiting.dueAt) / 1000)));
      if (decision === "silent") {
        paint(waiting.view);
        track("theme_transition_played", {
          outcome: "silent",
          period,
          waited_s: waited,
          reduced: live.current.reduced,
          preview: false,
          custom,
        });
        return;
      }
      playing.current = true;
      if (isSoundEnabled()) playPeriodTone(period);
      setPlan({
        id: now,
        name: waiting.block.name,
        caption: waiting.block.caption,
        period,
        view: waiting.view,
        reduced: live.current.reduced,
        preview: false,
        waited,
      });
    }, GATE_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [gateState, paint]);

  // "Preview the transition" from Settings → Appearance.
  useEffect(
    () =>
      transitionPreview.subscribe((block) => {
        if (playing.current) return;
        const view = live.current.viewFor(block.theme);
        if (!view) return;
        const period = periodOf(block.start);
        playing.current = true;
        if (isSoundEnabled()) playPeriodTone(period);
        setPlan({
          id: Date.now(),
          name: block.name,
          caption: block.caption,
          period,
          view,
          reduced: live.current.reduced,
          preview: true,
          waited: 0,
        });
      }),
    [],
  );

  if (!plan) return null;
  return (
    <TransitionOverlay
      key={plan.id}
      plan={plan}
      onApply={() => paint(plan.view)}
      onDone={(outcome) => {
        track("theme_transition_played", {
          outcome,
          period: plan.period,
          waited_s: plan.waited,
          reduced: plan.reduced,
          preview: plan.preview,
          custom: Object.keys(plan.view.attrs).length > 0,
        });
        setPlan(null);
        const restore = () => {
          playing.current = false;
          const { view } = target(Date.now());
          if (view) paint(view);
        };
        if (plan.preview) window.setTimeout(restore, PREVIEW_HOLD_MS);
        else playing.current = false;
      }}
    />
  );
}
