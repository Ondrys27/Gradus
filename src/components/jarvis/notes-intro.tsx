"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { NotebookPenIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useProfile, useSession, useUpdateProfile } from "@/features/account/queries";
import { coldCallingKeys } from "@/features/cold-calling/timer-queries";
import type { TimerReading } from "@/features/cold-calling/timer-logic";
import { jarvisOverlay, useJarvisOverlay } from "@/features/jarvis/overlay-store";
import { clientBlock, NOTES_INTRO_SETTLE_MS, notesIntroDue } from "@/features/jarvis/proactive";
import { track } from "@/lib/analytics/client";
import { useIsPhone, useReducedMotionSafe } from "@/lib/use-media-query";
import { Jarvis, JARVIS_SIZES, type JarvisState } from "./jarvis";
import { SpeechBubble, TypedText } from "./speech-bubble";

const TICK_MS = 1_000;

function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * Once in the life of an account Jarvis flies in to say that the groundwork
 * for milestones and tasks belongs in Notes, and that he reads it. A fixed
 * text, no model call. It comes after the guided tour and its celebration,
 * never over a dialog or his panel, and takes the session's one proactive
 * appearance, so nothing else of his lands on top of it.
 */
export function NotesIntro({ panelOpen }: { panelOpen: boolean }) {
  const { user, worker } = useSession();
  const profile = useProfile();
  const queryClient = useQueryClient();
  const updateProfile = useUpdateProfile();
  const tourActive = useJarvisOverlay((state) => state.tourActive);
  const shownThisSession = useJarvisOverlay((state) => state.proactiveShown);
  const [visible, setVisible] = useState(false);

  const due = notesIntroDue({
    worker: Boolean(worker),
    onboardingCompletedAt: profile.onboarding_completed_at,
    tourCompletedAt: profile.tour_completed_at,
    notesIntroSeenAt: profile.notes_intro_seen_at,
  });

  const busy = panelOpen || tourActive;
  const state = useRef({ busy });
  state.current = { busy };

  useEffect(() => {
    if (!due || shownThisSession || visible) return;
    let calmSince = Date.now();
    const interval = window.setInterval(() => {
      const timer = queryClient.getQueryData<TimerReading>(coldCallingKeys.timer(user.id));
      const now = Date.now();
      const blocked = clientBlock({
        now,
        pageSince: calmSince,
        shownThisSession: jarvisOverlay.get().proactiveShown,
        timerRunning: timer?.running ?? false,
        dialogOpen: dialogOpen(),
        busy: state.current.busy,
        visible: document.visibilityState === "visible",
        settleMs: NOTES_INTRO_SETTLE_MS,
      });
      if (blocked === "settling") return;
      if (blocked) {
        // Anything on screen starts the calm period again once it is gone.
        calmSince = now;
        return;
      }
      window.clearInterval(interval);
      jarvisOverlay.markProactiveShown();
      setVisible(true);
      // Stamped when shown: it never comes back, whatever the user does next.
      updateProfile.mutate({ notes_intro_seen_at: new Date().toISOString() });
      track("jarvis_notes_intro", { action: "shown" });
    }, TICK_MS);
    return () => window.clearInterval(interval);
    // `updateProfile.mutate` is stable; the rest is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, shownThisSession, visible, queryClient, user.id]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-0 z-nav overflow-hidden">
      <AnimatePresence>
        {visible && <NotesIntroCallout key="notes-intro" onDone={() => setVisible(false)} />}
      </AnimatePresence>
    </div>
  );
}

function NotesIntroCallout({ onDone }: { onDone: () => void }) {
  const t = useTranslations("jarvis.notesIntro");
  const router = useRouter();
  const reduceMotion = useReducedMotionSafe();
  const isPhone = useIsPhone();
  const [pose, setPose] = useState<JarvisState>("waving");

  useEffect(() => {
    const timer = window.setTimeout(() => setPose("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, []);

  const close = () => {
    track("jarvis_notes_intro", { action: "close" });
    onDone();
  };
  const open = () => {
    track("jarvis_notes_intro", { action: "open" });
    router.push("/app/poznamky");
    onDone();
  };

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 1, transition: { duration: 0.8 } }}
      data-testid="notes-intro"
      className="pointer-events-auto absolute bottom-[calc(12px+64px+12px+env(safe-area-inset-bottom))] left-[max(16px,env(safe-area-inset-left))] flex w-[min(380px,calc(100vw-32px))] flex-col-reverse items-start gap-1 md:bottom-[max(24px,env(safe-area-inset-bottom))] md:left-[calc(--spacing(19)+env(safe-area-inset-left)+24px)] md:w-auto md:flex-row md:items-end md:gap-2 lg:left-[calc(--spacing(60)+env(safe-area-inset-left)+32px)]"
    >
      <Jarvis size={JARVIS_SIZES.bubble} state={pose} enterFrom="left" />
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
        transition={reduceMotion ? { duration: 0 } : { delay: 0.6, duration: 0.25 }}
        className="w-full origin-bottom-left md:mb-10 md:w-[340px]"
      >
        <SpeechBubble
          tail={isPhone ? { side: "bottom", align: "start" } : { side: "left", align: "end" }}
          onClose={close}
          closeLabel={t("close")}
        >
          <p className="mb-1 text-xs font-semibold tracking-wide text-teal uppercase">
            {t("heading")}
          </p>
          <TypedText text={t("text")} />
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={open}>
              <NotebookPenIcon aria-hidden />
              {t("open")}
            </Button>
          </div>
        </SpeechBubble>
      </motion.div>
    </motion.div>
  );
}
