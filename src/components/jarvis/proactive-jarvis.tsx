"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, PlusIcon, SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProfile, useSession, useUserSettings } from "@/features/account/queries";
import { coldCallingKeys } from "@/features/cold-calling/timer-queries";
import type { TimerReading } from "@/features/cold-calling/timer-logic";
import { jarvisOverlay, useJarvisOverlay } from "@/features/jarvis/overlay-store";
import { clientBlock } from "@/features/jarvis/proactive";
import { fetchProactive, useProactiveReaction } from "@/features/jarvis/proactive-queries";
import type { ProactiveItem } from "@/features/jarvis/protocol";
import { ANSWER_MAX, questionByKey } from "@/features/jarvis/questions";
import type { Suggestion } from "@/features/jarvis/suggestions";
import type { SuggestionType } from "@/features/jarvis/suggestion-types";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { Jarvis, JARVIS_SIZES, type JarvisState } from "./jarvis";
import { SpeechBubble, TypedText } from "./speech-bubble";
import { useSuggestionText } from "./suggestion-card";

/** How often the browser looks whether Jarvis may appear; the check itself is local. */
const TICK_MS = 5_000;
/** How long to wait before asking the server again when it had nothing. */
const RECHECK_MS = 15 * 60_000;
/** After a refused moment (a dialog opened meanwhile), try again a little later. */
const RETRY_MS = 60_000;
/** "Added" stays this long before Jarvis flies off. */
const CONFIRM_MS = 1_400;

function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * Jarvis speaking up on his own: he flies into the bottom-left corner of the
 * content (the bottom-right belongs to his button) with one thing to say,
 * the morning brief, a suggestion or a question. Only when the rules allow
 * it (see features/jarvis/proactive.ts) and only when there is something.
 */
export function ProactiveJarvis({
  panelOpen,
  onAsk,
}: {
  panelOpen: boolean;
  /** Opens the panel and sends the question to Jarvis. */
  onAsk: (prompt: string) => void;
}) {
  const { user, worker } = useSession();
  const profile = useProfile();
  const settings = useUserSettings();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const tourActive = useJarvisOverlay((state) => state.tourActive);
  const shownThisSession = useJarvisOverlay((state) => state.proactiveShown);
  const reaction = useProactiveReaction();
  const [item, setItem] = useState<ProactiveItem | null>(null);

  // The 30 seconds count from every page change, not only from the first load.
  const pageSince = useRef(Date.now());
  useEffect(() => {
    pageSince.current = Date.now();
  }, [pathname]);

  const enabled =
    !worker &&
    settings.jarvis_proactive &&
    !!profile.onboarding_completed_at &&
    !!profile.tour_completed_at;

  const busy = panelOpen || tourActive;
  const state = useRef({ busy, shownThisSession });
  state.current = { busy, shownThisSession };
  const nextCheck = useRef(0);
  const fetching = useRef(false);

  const blocked = useCallback(() => {
    const timer = queryClient.getQueryData<TimerReading>(coldCallingKeys.timer(user.id));
    return clientBlock({
      now: Date.now(),
      pageSince: pageSince.current,
      shownThisSession: state.current.shownThisSession,
      timerRunning: timer?.running ?? false,
      dialogOpen: dialogOpen(),
      busy: state.current.busy,
      visible: document.visibilityState === "visible",
    });
  }, [queryClient, user.id]);

  useEffect(() => {
    if (!enabled || shownThisSession) return;
    const tick = async () => {
      if (fetching.current || Date.now() < nextCheck.current || blocked()) return;
      fetching.current = true;
      try {
        const response = await fetchProactive();
        nextCheck.current = response.retryAt
          ? Date.parse(response.retryAt)
          : Date.now() + RECHECK_MS;
        if (!response.item) return;
        // The moment may have passed while asking (a dialog opened, the panel too).
        if (blocked()) {
          nextCheck.current = Date.now() + RETRY_MS;
          return;
        }
        jarvisOverlay.markProactiveShown();
        setItem(response.item);
        reaction.mutate({ id: response.item.id, reaction: "shown" });
      } finally {
        fetching.current = false;
      }
    };
    const interval = window.setInterval(() => void tick(), TICK_MS);
    return () => window.clearInterval(interval);
    // `reaction.mutate` is stable; the rest is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, shownThisSession, blocked]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-0 z-nav overflow-hidden">
      <AnimatePresence>
        {item && (
          <ProactiveCallout key={item.id} item={item} onDone={() => setItem(null)} onAsk={onAsk} />
        )}
      </AnimatePresence>
    </div>
  );
}

function ProactiveCallout({
  item,
  onDone,
  onAsk,
}: {
  item: ProactiveItem;
  onDone: () => void;
  onAsk: (prompt: string) => void;
}) {
  const t = useTranslations("jarvis.proactive");
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const reaction = useProactiveReaction();
  const suggestionText = useSuggestionText();
  const isPhone = useIsPhone();
  const [added, setAdded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [answer, setAnswer] = useState("");
  const [pose, setPose] = useState<JarvisState>("waving");

  useEffect(() => {
    const timer = window.setTimeout(() => setPose("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, []);

  const react = (name: "open" | "later" | "close") => {
    reaction.mutate({ id: item.id, reaction: name });
    onDone();
  };

  const question = item.questionKey ? questionByKey(item.questionKey) : undefined;
  let text = item.text;
  let prompt = "";
  if (item.kind === "suggestion") {
    const suggestion: Suggestion = {
      id: item.id,
      type: item.type as SuggestionType,
      text: item.text,
      action: item.action,
      seen: true,
      createdAt: item.createdAt,
    };
    const worded = suggestionText(suggestion);
    text = worded.detail ? `${worded.title}\n${worded.detail}` : worded.title;
    prompt = worded.prompt || (item.action.kind === "ask" ? worded.title : "");
  } else if (item.kind === "question" && question) {
    text = t(`questions.${question.key}.text`);
  }

  const href =
    item.action.kind === "open"
      ? item.action.href
      : item.type === "stalledDeal"
        ? "/app/pipeline"
        : null;

  const show = () => {
    if (href) router.push(href);
    else if (prompt) onAsk(prompt);
    react("open");
  };

  const accept = () => {
    setFailed(false);
    reaction.mutate(
      { id: item.id, reaction: "accept" },
      {
        onSuccess: () => {
          setAdded(true);
          window.setTimeout(onDone, CONFIRM_MS);
        },
        onError: () => setFailed(true),
      },
    );
  };

  const sendAnswer = (value: string) => {
    if (!value.trim()) return;
    setFailed(false);
    reaction.mutate(
      { id: item.id, reaction: "answer", answer: value },
      {
        onSuccess: () => {
          setAdded(true);
          window.setTimeout(onDone, CONFIRM_MS);
        },
        onError: () => setFailed(true),
      },
    );
  };

  const busy = reaction.isPending || added;

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 1, transition: { duration: 0.8 } }}
      className="pointer-events-auto absolute bottom-[calc(12px+64px+12px+env(safe-area-inset-bottom))] left-[max(16px,env(safe-area-inset-left))] flex w-[min(380px,calc(100vw-32px))] flex-col-reverse items-start gap-1 md:bottom-[max(24px,env(safe-area-inset-bottom))] md:left-[calc(--spacing(19)+env(safe-area-inset-left)+24px)] md:w-auto md:flex-row md:items-end md:gap-2 lg:left-[calc(--spacing(60)+env(safe-area-inset-left)+32px)]"
    >
      <Jarvis size={JARVIS_SIZES.bubble} state={added ? "happy" : pose} enterFrom="left" />
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
        transition={reduceMotion ? { duration: 0 } : { delay: 0.6, duration: 0.25 }}
        className="w-full origin-bottom-left md:mb-10 md:w-[340px]"
      >
        <SpeechBubble
          tail={isPhone ? { side: "bottom", align: "start" } : { side: "left", align: "end" }}
          onClose={() => react("close")}
          closeLabel={t("close")}
        >
          <p className="mb-1 text-xs font-semibold tracking-wide text-teal uppercase">
            {t(`heading.${item.kind}`)}
          </p>
          {added ? (
            <p className="flex items-center gap-2 text-[15px] text-green" role="status">
              <CheckIcon aria-hidden className="size-4" />
              {item.kind === "question" ? t("answered") : t("added")}
            </p>
          ) : (
            <TypedText text={text} />
          )}

          {!added && item.tasks.length > 0 && (
            <ul aria-label={t("tasksPreview")} className="mt-3 flex flex-col gap-1.5">
              {item.tasks.map((task) => (
                <li
                  key={task}
                  className="flex items-start gap-2 rounded-xl border border-line bg-canvas-deep/50 px-3 py-2 text-sm text-ink-soft"
                >
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-violet" />
                  <span className="min-w-0 break-words">{task}</span>
                </li>
              ))}
            </ul>
          )}

          {!added && question && (
            <div className="mt-3 flex flex-col gap-2">
              {Object.keys(question.options).length > 0 && (
                <div role="group" aria-label={t("options")} className="flex flex-wrap gap-2">
                  {Object.keys(question.options).map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={busy}
                      onClick={() => sendAnswer(option)}
                      className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-surface-hover px-3.5 text-sm text-ink outline-none transition-colors hover:border-teal/60 focus-visible:ring-3 focus-visible:ring-teal/50 disabled:opacity-50 mouse:min-h-9"
                    >
                      {t(`questions.${question.key}.options.${option}`)}
                    </button>
                  ))}
                </div>
              )}
              {question.freeText && (
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendAnswer(answer);
                  }}
                >
                  <Input
                    value={answer}
                    maxLength={ANSWER_MAX}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder={t("answerPlaceholder")}
                    aria-label={t("answerLabel")}
                    className="h-11 min-w-0 flex-1 mouse:h-9"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={busy || !answer.trim()}
                    aria-label={t("send")}
                  >
                    <SendIcon aria-hidden />
                  </Button>
                </form>
              )}
            </div>
          )}

          {failed && (
            <p role="alert" className="mt-2 text-xs text-pink">
              {t("failed")}
            </p>
          )}

          {!added && (
            <div className="mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto">
              {item.kind === "briefing" && (
                <Button size="sm" onClick={() => react("close")}>
                  {t("thanks")}
                </Button>
              )}
              {item.tasks.length > 0 && (
                <Button size="sm" disabled={busy} onClick={accept}>
                  <PlusIcon aria-hidden />
                  {t("add")}
                </Button>
              )}
              {item.kind === "suggestion" && (href || prompt) && (
                <Button
                  size="sm"
                  variant={item.tasks.length > 0 ? "secondary" : "default"}
                  disabled={busy}
                  onClick={show}
                >
                  {href ? t("show") : t("ask")}
                </Button>
              )}
              {item.kind !== "briefing" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  className={cn(item.kind === "question" && "-ml-2.5")}
                  onClick={() => react("later")}
                >
                  {t("later")}
                </Button>
              )}
            </div>
          )}
        </SpeechBubble>
      </motion.div>
    </motion.div>
  );
}
