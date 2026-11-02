"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useProfile, useSession, useUserSettings } from "@/features/account/queries";
import { coldCallingKeys } from "@/features/cold-calling/timer-queries";
import type { TimerReading } from "@/features/cold-calling/timer-logic";
import { jarvisOverlay, useJarvisOverlay } from "@/features/jarvis/overlay-store";
import { clientBlock, SUMMARY_SETTLE_MS } from "@/features/jarvis/proactive";
import { fetchSummary, useProactiveReaction } from "@/features/jarvis/proactive-queries";
import type { SummaryItem, SummaryLink } from "@/features/jarvis/protocol";
import { formatNumber, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useIsPhone, useMediaQuery, useReducedMotionSafe } from "@/lib/use-media-query";
import { Jarvis, JARVIS_SIZES, type JarvisState } from "./jarvis";
import { SpeechBubble, TypedText } from "./speech-bubble";

/** As beside the proactive card: narrower, the summary steps aside while the chat is open. */
const BESIDE_PANEL_QUERY = "(min-width: 1220px)";

function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * The summary at the first arrival of the day (week, month by the frequency):
 * right after the page loads Jarvis flies into the bottom-left corner with
 * what the day holds, worked out on the server from the data now, and rows
 * to what needs the user. Never over the tour, a dialog, his panel or a
 * running call timer, and not in quiet hours: then it waits for the next
 * page. Shown once per period (the server settles it when it comes on
 * screen); closing it or opening a row puts it away.
 */
export function DaySummary({ panelOpen }: { panelOpen: boolean }) {
  const { user, worker } = useSession();
  const profile = useProfile();
  const settings = useUserSettings();
  const format = useFormatSettings();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const tourActive = useJarvisOverlay((state) => state.tourActive);
  const reaction = useProactiveReaction();
  const [item, setItem] = useState<SummaryItem | null>(null);
  const besidePanel = useMediaQuery(BESIDE_PANEL_QUERY);
  const visible = item !== null && !(panelOpen && !besidePanel);

  const enabled =
    !worker &&
    settings.jarvis_proactive &&
    !!profile.onboarding_completed_at &&
    !!profile.tour_completed_at;

  // The day (user's zone) the summary was settled for; a new day asks again.
  const settledOn = useRef<string | null>(null);
  const fetching = useRef(false);
  const state = useRef({ busy: panelOpen || tourActive, format });
  state.current = { busy: panelOpen || tourActive, format };

  const blocked = useCallback(() => {
    const timer = queryClient.getQueryData<TimerReading>(coldCallingKeys.timer(user.id));
    return clientBlock({
      now: Date.now(),
      pageSince: 0,
      shownThisSession: false,
      timerRunning: timer?.running ?? false,
      dialogOpen: dialogOpen(),
      busy: state.current.busy || jarvisOverlay.get().noticeOpen,
      visible: document.visibilityState === "visible",
      settleMs: 0,
    });
  }, [queryClient, user.id]);

  // Each page (the first load and every change) is one chance, once it is drawn.
  useEffect(() => {
    if (!enabled || item) return;
    const today = () => todayIsoDate(state.current.format);
    if (settledOn.current === today()) return;
    const attempt = async () => {
      if (fetching.current || settledOn.current === today() || blocked()) return;
      fetching.current = true;
      try {
        const response = await fetchSummary();
        if (response.status === "none") {
          settledOn.current = today();
          return;
        }
        // Quiet hours, the timer, or the moment passed while asking: the next page.
        if (response.status === "wait" || blocked()) return;
        settledOn.current = today();
        jarvisOverlay.setSummaryOpen(true);
        setItem(response.item);
      } finally {
        fetching.current = false;
      }
    };
    const timer = window.setTimeout(() => void attempt(), SUMMARY_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, item, pathname, blocked]);

  // It counts as shown when it first comes on screen; the server then settles the period.
  const shown = useRef<string | null>(null);
  const currentId = visible && item ? item.id : null;
  useEffect(() => {
    if (!currentId || shown.current === currentId) return;
    shown.current = currentId;
    reaction.mutate({ id: currentId, reaction: "shown" });
    // `reaction.mutate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const done = useCallback(() => {
    setItem(null);
    jarvisOverlay.setSummaryOpen(false);
  }, []);

  useEffect(() => () => jarvisOverlay.setSummaryOpen(false), []);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-0 z-nav overflow-hidden">
      <AnimatePresence>
        {visible && item && <SummaryCallout key={item.id} item={item} onDone={done} />}
      </AnimatePresence>
    </div>
  );
}

function SummaryCallout({ item, onDone }: { item: SummaryItem; onDone: () => void }) {
  const t = useTranslations("jarvis.summary");
  const router = useRouter();
  const reduceMotion = useReducedMotionSafe();
  const isPhone = useIsPhone();
  const reaction = useProactiveReaction();
  const [pose, setPose] = useState<JarvisState>("waving");

  useEffect(() => {
    const timer = window.setTimeout(() => setPose("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, []);

  const close = () => {
    reaction.mutate({ id: item.id, reaction: "close" });
    onDone();
  };
  const open = (link: SummaryLink) => {
    reaction.mutate({ id: item.id, reaction: "open" });
    router.push(link.href);
    onDone();
  };

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 1, transition: { duration: 0.8 } }}
      className="pointer-events-auto absolute bottom-[calc(12px+64px+12px+env(safe-area-inset-bottom))] left-[max(16px,env(safe-area-inset-left))] flex w-[min(380px,calc(100vw-32px))] flex-col-reverse items-start gap-1 md:bottom-[max(24px,env(safe-area-inset-bottom))] md:left-[calc(--spacing(19)+env(safe-area-inset-left)+24px)] md:w-auto md:flex-row md:items-end md:gap-2 lg:left-[calc(--spacing(60)+env(safe-area-inset-left)+32px)]"
    >
      <Jarvis size={JARVIS_SIZES.bubble} state={pose} enterFrom="left" />
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
        transition={reduceMotion ? { duration: 0 } : { delay: 0.6, duration: 0.25 }}
        role="group"
        aria-label={t(`heading.${item.period}`)}
        data-testid="jarvis-summary"
        className="w-full origin-bottom-left md:mb-10 md:w-[360px]"
      >
        <SpeechBubble
          tail={isPhone ? { side: "bottom", align: "start" } : { side: "left", align: "end" }}
          onClose={close}
          closeLabel={t("close")}
        >
          <p className="mb-1 text-xs font-semibold tracking-wide text-teal uppercase">
            {t(`heading.${item.period}`)}
          </p>
          <TypedText text={item.text} />
          {item.links.length > 0 && <SummaryLinks item={item} onOpen={open} />}
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={close}>
              {t("thanks")}
            </Button>
          </div>
        </SpeechBubble>
      </motion.div>
    </motion.div>
  );
}

function SummaryLinks({ item, onOpen }: { item: SummaryItem; onOpen: (link: SummaryLink) => void }) {
  const t = useTranslations("jarvis.summary");
  const format = useFormatSettings();
  return (
    <ul aria-label={t("linksLabel")} className="mt-3 flex flex-col gap-1.5">
      {item.links.map((link) => (
        <li key={link.key}>
          <button
            type="button"
            onClick={() => onOpen(link)}
            className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl border border-line bg-canvas-deep/50 px-3 text-left text-sm text-ink-soft outline-none transition-colors hover:border-teal/60 hover:text-ink focus-visible:ring-3 focus-visible:ring-teal/50 mouse:min-h-9"
          >
            <span className="min-w-0 flex-1 truncate">
              {t(`links.${link.key}`, { period: item.period })}
            </span>
            <span className="shrink-0 font-semibold text-ink tabular-nums">
              {formatNumber(link.count, {}, format)}
            </span>
            <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
          </button>
        </li>
      ))}
    </ul>
  );
}
