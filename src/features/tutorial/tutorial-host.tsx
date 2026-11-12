"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCelebrationOpen } from "@/components/celebration/celebration-state";
import { navItems, type NavKey } from "@/components/layout/nav-items";
import { useNavItems } from "@/components/layout/use-nav";
import { useProfile, useSession } from "@/features/account/queries";
import { useCan } from "@/features/account/workspace-queries";
import { useFirstActiveMilestone } from "@/features/game/overview-queries";
import { useAwardXp, useGameState, useIsPlaying } from "@/features/game/queries";
import { gradyOverlay, useGradyOverlay } from "@/features/grady/overlay-store";
import { track } from "@/lib/analytics/client";
import {
  atStep,
  choiceDue,
  endState,
  isRunning,
  planSteps,
  resumeHow,
  resumeIndex,
  startState,
  type PlannedStep,
} from "./engine";
import { useDeleteDemo, useSaveTutorial, useSeedDemo, useTutorialState } from "./queries";
import { tutorialSteps, type TutorialSection } from "./steps";
import type { FirstAction } from "./tutorial-overlay";
import { TutorialResume } from "./tutorial-resume";
import type { DemoResolution, RunningMode, TutorialMode, TutorialState } from "./types";

/** Only while a tutorial runs; not in the app bundle. */
const TutorialOverlay = dynamic(
  () => import("./tutorial-overlay").then((module) => module.TutorialOverlay),
  { ssr: false },
);

/** Asked once after onboarding and on request; not in the app bundle either. */
const TutorialChoice = dynamic(
  () => import("./tutorial-choice").then((module) => module.TutorialChoice),
  { ssr: false },
);

/** Lets the onboarding wizard and its celebration leave before Grady asks. */
const START_DELAY_MS = 1200;

type Phase = "idle" | "choice" | "resume" | "running";

/**
 * Grady's tutorial in the app frame: asks how to start once onboarding is
 * done (a worker on the first visit) and whenever Settings → Grady or his
 * panel asks for it, runs the chosen one, stores the progress after every
 * step (profiles.tutorial) and picks it up again after a reload (at once) or
 * later (Grady offers to go on). Any end stamps tour_completed_at, which the
 * rest of Grady waits for.
 */
export function TutorialHost() {
  const t = useTranslations("tutorial");
  const { worker } = useSession();
  const profile = useProfile();
  const playing = useIsPlaying();
  const game = useGameState();
  const router = useRouter();
  const stored = useTutorialState();
  const { save } = useSaveTutorial();
  const seed = useSeedDemo();
  const deleteDemo = useDeleteDemo();
  const award = useAwardXp();
  const celebrating = useCelebrationOpen();
  const request = useGradyOverlay((state) => state.tutorialRequest);
  const canWrite = useCan("milestones", "edit");
  const { items } = useNavItems();

  const [phase, setPhase] = useState<Phase>("idle");
  const [state, setState] = useState<TutorialState | null>(null);
  const [index, setIndex] = useState(0);
  const [starting, setStarting] = useState<TutorialMode | null>(null);
  const [failed, setFailed] = useState(false);
  const [ending, setEnding] = useState(false);
  const skipped = useRef(0);
  const replay = useRef(false);
  const handledRequest = useRef(request);
  const resumeChecked = useRef(false);

  // Locks are known only once the game state is in (game mode); until then nothing starts.
  const ready = !playing || game.isSuccess;
  const mode = state?.mode ?? "none";
  const order = useMemo(
    () => (mode !== "none" ? tutorialSteps(mode, { worker: Boolean(worker), playing }) : []),
    [mode, worker, playing],
  );
  const access = useMemo(() => {
    const present = new Set<NavKey>(items.map((item) => item.key));
    const missing = new Set<TutorialSection>(
      navItems.map((item) => item.key).filter((key) => !present.has(key)),
    );
    const locked = new Set<TutorialSection>(
      items.filter((item) => item.locked).map((item) => item.key),
    );
    return { locked, missing };
  }, [items]);
  const steps: PlannedStep[] = useMemo(() => planSteps(order, access), [order, access]);

  // The first choice: after onboarding and its celebration, once.
  const due = choiceDue({
    state: stored,
    tourCompletedAt: profile.tour_completed_at,
    onboarded: !!profile.onboarding_completed_at,
    worker: Boolean(worker),
  });
  useEffect(() => {
    if (!due || celebrating || phase !== "idle") return;
    const timer = window.setTimeout(() => setPhase("choice"), START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [due, celebrating, phase]);

  // Asked for again (Settings → Grady, the panel).
  useEffect(() => {
    if (request === handledRequest.current) return;
    handledRequest.current = request;
    replay.current = true;
    setFailed(false);
    setPhase("choice");
  }, [request]);

  // A tutorial left half way: straight on after a reload, an offer after a while.
  useEffect(() => {
    if (resumeChecked.current || !ready || phase !== "idle") return;
    resumeChecked.current = true;
    if (!isRunning(stored)) return;
    // Placed at once, so the first step never opens its page on the way.
    const resumed = tutorialSteps(stored.mode, { worker: Boolean(worker), playing });
    setIndex(resumeIndex(planSteps(resumed, access), resumed, stored.step));
    setState(stored);
    setPhase(resumeHow(stored, new Date()) === "direct" ? "running" : "resume");
  }, [ready, stored, phase, worker, playing, access]);

  useEffect(() => {
    gradyOverlay.setTourActive(phase !== "idle");
    return () => gradyOverlay.setTourActive(false);
  }, [phase]);

  // Every step shown is stored and counted.
  const current = phase === "running" ? steps[Math.min(index, steps.length - 1)] : undefined;
  const shownKey = current ? `${state?.started_at}:${current.key}` : null;
  const lastShown = useRef<string | null>(null);
  useEffect(() => {
    if (!current || !state || state.mode === "none" || !shownKey) return;
    if (lastShown.current === shownKey) return;
    lastShown.current = shownKey;
    const position = Math.min(index, steps.length - 1);
    track("tutorial_step", {
      mode: state.mode,
      key: current.key,
      index: position,
      total: steps.length,
    });
    if (state.step !== current.key) {
      const next = atStep(state, current.key, new Date());
      setState(next);
      void save(next).catch(() => undefined);
    }
  }, [current, shownKey, state, index, steps.length, save]);

  const choose = useCallback(
    async (mode: TutorialMode) => {
      setFailed(false);
      setStarting(mode);
      try {
        let startedAt: string | undefined;
        if (mode === "full") startedAt = await seed.mutateAsync();
        const next = startState(mode, new Date(), startedAt);
        await save(next);
        track("tutorial_started", { mode, replay: replay.current });
        skipped.current = 0;
        lastShown.current = null;
        if (mode === "none") {
          setState(null);
          setPhase("idle");
        } else {
          setState(next);
          setIndex(0);
          setPhase("running");
        }
      } catch {
        setFailed(true);
      } finally {
        setStarting(null);
      }
    },
    [seed, save],
  );

  const closeChoice = useCallback(() => {
    // The first, automatic ask closed without a pick counts as Skip, so it does not come back.
    if (due && !replay.current) void choose("none");
    else setPhase(isRunning(state) ? "running" : "idle");
  }, [due, choose, state]);

  const move = useCallback(
    (nextIndex: number, how: "next" | "skip") => {
      if (how === "skip") skipped.current += 1;
      setIndex(Math.min(nextIndex, Math.max(steps.length - 1, 0)));
    },
    [steps.length],
  );

  const end = useCallback(
    async (how: "finished" | "abandoned", demo: DemoResolution | null, href?: string) => {
      if (!state || state.mode === "none") return;
      setEnding(true);
      try {
        if (demo === "deleted") await deleteDemo.mutateAsync();
        const running: RunningMode = state.mode;
        const done = endState(state, how, new Date(), demo);
        await save(done);
        const position = Math.min(index, steps.length - 1);
        if (how === "finished") {
          track("tutorial_finished", {
            mode: running,
            total: steps.length,
            skipped: Math.min(skipped.current, 60),
            demo: demo ?? "none",
            replay: replay.current,
          });
          award.mutate({
            reason: "tutorial_completed",
            celebration: (result) =>
              result.awarded
                ? {
                    title: t("celebration.title"),
                    subtitle: t(`celebration.${running}`),
                    xp: result.xp,
                  }
                : null,
          });
        } else {
          track("tutorial_abandoned", {
            mode: running,
            step: steps[position]?.key ?? "welcome",
            index: position,
            total: steps.length,
            demo: demo ?? "none",
          });
        }
        setState(null);
        setPhase("idle");
        if (href) router.push(href);
      } catch {
        // Stays on screen; the buttons can be pressed again.
      } finally {
        setEnding(false);
      }
    },
    [state, deleteDemo, save, index, steps, award, t, router],
  );

  const firstMilestone = useFirstActiveMilestone(phase === "running");
  const firstAction: FirstAction = worker
    ? { label: t("action.openTasks"), href: "/app/ukoly-crm", target: null }
    : firstMilestone.data
      ? {
          label: t("action.openFirstTask"),
          href: `/app/milniky/${firstMilestone.data.id}`,
          target: firstMilestone.data.title,
        }
      : { label: t("action.createMilestone"), href: "/app/milniky", target: null };

  const resumeStep = state?.step ? steps.find((step) => step.key === state.step) : undefined;

  return (
    <>
      {phase === "choice" && (
        <TutorialChoice
          open
          allowFull={!worker && canWrite}
          pending={starting}
          failed={failed}
          onChoose={(mode) => void choose(mode)}
          onClose={closeChoice}
        />
      )}
      {phase === "resume" && state && state.mode !== "none" && (
        <TutorialResume
          mode={state.mode}
          stepTitle={resumeStep ? t(`steps.${resumeStep.key}.title`) : null}
          pending={ending}
          onResume={() => setPhase("running")}
          onEnd={(demo) => void end("abandoned", demo)}
        />
      )}
      {phase === "running" && state && state.mode !== "none" && steps.length > 0 && (
        <TutorialOverlay
          mode={state.mode}
          steps={steps}
          index={Math.min(index, steps.length - 1)}
          since={state.started_at}
          onMove={move}
          onEnd={(how, demo, href) => void end(how, demo, href)}
          firstAction={firstAction}
          pending={ending}
        />
      )}
    </>
  );
}
