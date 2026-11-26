"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCelebrationOpen } from "@/components/celebration/celebration-state";
import { navItems, workerOnlyItems, type NavKey } from "@/components/layout/nav-items";
import { useNavItems } from "@/components/layout/use-nav";
import { useProfile, useSession } from "@/features/account/queries";
import { useCan, useWorkspace } from "@/features/account/workspace-queries";
import { useFirstActiveMilestone } from "@/features/game/overview-queries";
import { useAwardXp, useGameState, useIsPlaying } from "@/features/game/queries";
import { gradyOverlay, useGradyOverlay } from "@/features/grady/overlay-store";
import { newSections } from "./access-offer";
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
import {
  accessTourSteps,
  tutorialSectionsOf,
  tutorialSteps,
  type TutorialAudience,
  type TutorialSection,
} from "./steps";
import { TutorialAccessOffer } from "./tutorial-access-offer";
import type { FirstAction } from "./tutorial-overlay";
import { TutorialResume } from "./tutorial-resume";
import { SHOWCASE_PATH } from "./showcase/params";
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

/** The offer of new sections waits this long on a calm page. */
const OFFER_DELAY_MS = 4000;

type Phase = "idle" | "choice" | "resume" | "running" | "offer" | "tour";

/**
 * Grady's tutorial in the app frame: asks how to start once onboarding is
 * done (a worker on the first visit) and whenever Settings → Grady or his
 * panel asks for it, runs the chosen one, stores the progress after every
 * step (profiles.tutorial; in a company space_tutorials) and picks it up
 * again after a reload (at once) or later (Grady offers to go on). Any end
 * stamps tour_completed_at, which the rest of Grady waits for. A worker gets
 * the tutorial of their rights after the first entry into each company, and
 * a short look at sections the owner opens to them later (30.2), once.
 */
export function TutorialHost() {
  const t = useTranslations("tutorial");
  const { worker, showcase, spaces, spaceId } = useSession();
  const space = spaces.find((entry) => entry.spaceId === spaceId);
  const companyName = space?.companyName ?? space?.ownerName ?? null;
  const profile = useProfile();
  const playing = useIsPlaying();
  const game = useGameState();
  const router = useRouter();
  const store = useTutorialState();
  const stored = store.state;
  const { save, saveKnownSections } = useSaveTutorial();
  const workspace = useWorkspace();
  const tNav = useTranslations("nav");
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

  // Locks are known only once the game state is in (game mode), a company's tutorial once read.
  const ready = (!playing || game.isSuccess) && store.ready;
  const mode = state?.mode ?? "none";
  const audience: TutorialAudience = useMemo(
    () => ({
      worker: Boolean(worker),
      playing,
      grants: workspace.grants,
      readOnly: workspace.readOnly,
    }),
    [worker, playing, workspace.grants, workspace.readOnly],
  );
  // The sections a worker's tutorial talks about; what they had when it ended is remembered.
  const sections = useMemo(() => (worker ? tutorialSectionsOf(audience) : []), [worker, audience]);
  const [tourSections, setTourSections] = useState<NavKey[]>([]);
  const order = useMemo(() => {
    if (phase === "tour") return accessTourSteps(audience, tourSections);
    return mode !== "none" ? tutorialSteps(mode, audience) : [];
  }, [phase, mode, audience, tourSections]);
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

  // The first choice: after onboarding and its celebration, once (in a company: the first visit there).
  const due =
    store.ready &&
    choiceDue({
      state: stored,
      tourCompletedAt: worker ? null : profile.tour_completed_at,
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
    const resumed = tutorialSteps(stored.mode, audience);
    setIndex(resumeIndex(planSteps(resumed, access), resumed, stored.step));
    setState(stored);
    setPhase(resumeHow(stored, new Date()) === "direct" ? "running" : "resume");
  }, [ready, stored, phase, audience, access]);

  // A worker whose tutorial is behind them: sections opened to them since are offered once.
  const settled = Boolean(worker) && store.ready && !!stored && !isRunning(stored);
  const fresh = useMemo(
    () => (settled && store.knownSections ? newSections(store.knownSections, sections) : []),
    [settled, store.knownSections, sections],
  );
  useEffect(() => {
    // An older company tutorial without the list: what they have now counts as introduced.
    if (settled && !store.knownSections && sections.length) {
      void saveKnownSections(sections).catch(() => undefined);
    }
  }, [settled, store.knownSections, sections, saveKnownSections]);
  useEffect(() => {
    if (!ready || phase !== "idle" || celebrating || fresh.length === 0) return;
    const timer = window.setTimeout(() => {
      const overlay = gradyOverlay.get();
      const busy =
        overlay.noticeOpen ||
        overlay.summaryOpen ||
        overlay.proactiveShown ||
        document.visibilityState !== "visible" ||
        document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
      if (busy) return;
      // Offered once: remembered the moment it shows, whatever the answer.
      gradyOverlay.markProactiveShown();
      void saveKnownSections([...(store.knownSections ?? []), ...fresh]).catch(() => undefined);
      setTourSections(fresh);
      setPhase("offer");
      track("tutorial_access_offer", { outcome: "shown", sections: fresh.length });
    }, OFFER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, phase, celebrating, fresh, store.knownSections, saveKnownSections]);

  useEffect(() => {
    gradyOverlay.setTourActive(phase !== "idle");
    return () => gradyOverlay.setTourActive(false);
  }, [phase]);

  // Every step shown is stored and counted (not the short look at new sections).
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
        // Skipping in a company: what they have now counts as introduced.
        if (mode === "none" && worker) await saveKnownSections(sections).catch(() => undefined);
        const taught = tutorialSteps(mode === "none" ? "quick" : mode, audience);
        track("tutorial_started", {
          mode,
          replay: replay.current,
          worker: Boolean(worker),
          sections: Math.min(new Set(taught.map((step) => step.section)).size, 30),
        });
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
    [seed, save, saveKnownSections, worker, sections, audience],
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
        // A worker's samples sit in the company: they always go at the end.
        const resolution = worker && state.mode === "full" ? "deleted" : demo;
        if (resolution === "deleted") await deleteDemo.mutateAsync();
        const running: RunningMode = state.mode;
        const done = endState(state, how, new Date(), resolution);
        await save(done);
        if (worker) await saveKnownSections(sections).catch(() => undefined);
        const position = Math.min(index, steps.length - 1);
        if (how === "finished") {
          track("tutorial_finished", {
            mode: running,
            total: steps.length,
            skipped: Math.min(skipped.current, 60),
            demo: resolution ?? "none",
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
            demo: resolution ?? "none",
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
    [state, deleteDemo, save, saveKnownSections, worker, sections, index, steps, award, t, router],
  );

  const endTour = useCallback(
    (how: "finished" | "abandoned", href?: string) => {
      setPhase("idle");
      setTourSections([]);
      setIndex(0);
      if (how === "finished" && href) router.push(href);
    },
    [router],
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
  // The short look at new sections ends by opening the first of them.
  const tourStart = [...navItems, ...workerOnlyItems].find((item) => item.key === tourSections[0]);
  const tourAction: FirstAction = {
    label: t("accessOffer.open", { section: tourSections[0] ? tNav(tourSections[0]) : "" }),
    href: tourStart?.href ?? "/app",
    target: null,
  };

  return (
    <>
      {phase === "choice" && (
        <TutorialChoice
          open
          allowFull={worker ? !workspace.readOnly : canWrite}
          company={worker ? (companyName ?? "") : null}
          pending={starting}
          failed={failed}
          onChoose={(mode) => void choose(mode)}
          onClose={closeChoice}
          onShowcase={
            showcase === "presenter"
              ? () => {
                  setPhase("idle");
                  router.push(SHOWCASE_PATH);
                }
              : undefined
          }
        />
      )}
      {phase === "resume" && state && state.mode !== "none" && (
        <TutorialResume
          mode={state.mode}
          stepTitle={resumeStep ? t(`steps.${resumeStep.key}.title`) : null}
          pending={ending}
          onResume={() => setPhase("running")}
          onEnd={(demo) => void end("abandoned", demo)}
          demoChoice={!worker}
        />
      )}
      {phase === "offer" && (
        <TutorialAccessOffer
          sections={tourSections.map((key) => tNav(key))}
          onShow={() => {
            track("tutorial_access_offer", { outcome: "accepted", sections: tourSections.length });
            setIndex(0);
            setPhase("tour");
          }}
          onDismiss={() => {
            track("tutorial_access_offer", { outcome: "dismissed", sections: tourSections.length });
            endTour("abandoned");
          }}
        />
      )}
      {phase === "tour" && steps.length > 0 && (
        <TutorialOverlay
          mode="quick"
          steps={steps}
          index={Math.min(index, steps.length - 1)}
          since={null}
          onMove={move}
          onEnd={(how, _demo, href) => endTour(how, href)}
          firstAction={tourAction}
          pending={false}
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
          demoChoice={!worker}
        />
      )}
    </>
  );
}
