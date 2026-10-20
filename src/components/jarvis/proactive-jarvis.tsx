"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
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
import { useNoticeQueue } from "@/features/jarvis/use-notice-queue";
import { useIsPhone, useMediaQuery, useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { Jarvis, JARVIS_SIZES, type JarvisState } from "./jarvis";
import { NoticePager, NoticeSlide, queueKeyDown } from "./notice-queue";
import { SpeechBubble, TypedText } from "./speech-bubble";
import { useSuggestionText } from "./suggestion-card";

/** How often the browser looks whether Jarvis may appear; the check itself is local. */
const TICK_MS = 5_000;
/** How long to wait before asking the server again when it had nothing. */
const RECHECK_MS = 15 * 60_000;
/** After a refused moment (a dialog opened meanwhile), try again a little later. */
const RETRY_MS = 60_000;
/** "Added" stays this long before Jarvis flies off; he looks happy as long. */
const CONFIRM_MS = 1_400;

/**
 * Wide enough for the card (sidebar 240 + 32, Jarvis 140 + 8 + bubble 340)
 * to sit left of the open chat panel (420 wide, 24 from the right) with a
 * 16 px gap. Narrower, the card steps aside while the chat is open, so it
 * never covers the input or the last message, and comes back with its queue
 * when the chat closes.
 */
const BESIDE_PANEL_QUERY = "(min-width: 1220px)";

function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * Jarvis speaking up on his own: he flies into the bottom-left corner of the
 * content (the bottom-right belongs to his button) with what he has to say:
 * the morning brief, suggestions, a question. One card, one notice at a
 * time, the most urgent first; "2 of 5" with ‹ › (arrow keys, a swipe on a
 * phone) skips without losing anything, Close and a done action take the
 * notice out and the next one takes its place. Only when the rules allow it
 * (see features/jarvis/proactive.ts) and only when there is something.
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
  const [items, setItems] = useState<ProactiveItem[]>([]);
  const queue = useNoticeQueue(items);
  const besidePanel = useMediaQuery(BESIDE_PANEL_QUERY);
  const visible = items.length > 0 && !(panelOpen && !besidePanel);

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
        if (!response.items.length) return;
        // The moment may have passed while asking (a dialog opened, the panel too).
        if (blocked()) {
          nextCheck.current = Date.now() + RETRY_MS;
          return;
        }
        // One appearance carries the whole queue; the card shows one notice at a time.
        jarvisOverlay.markProactiveShown();
        setItems(response.items);
      } finally {
        fetching.current = false;
      }
    };
    const interval = window.setInterval(() => void tick(), TICK_MS);
    return () => window.clearInterval(interval);
  }, [enabled, shownThisSession, blocked]);

  // Each notice counts as shown when it first comes on screen, not when it waits in the queue.
  const shown = useRef(new Set<string>());
  const currentId = visible ? (queue.current?.id ?? null) : null;
  useEffect(() => {
    if (!currentId || shown.current.has(currentId)) return;
    shown.current.add(currentId);
    reaction.mutate({ id: currentId, reaction: "shown" });
    // `reaction.mutate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // Closed, postponed or done: it leaves the queue and the next one takes its place.
  const remove = useCallback(
    (id: string) => setItems((list) => list.filter((item) => item.id !== id)),
    [],
  );

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-0 z-nav overflow-hidden">
      <AnimatePresence>
        {visible && queue.current && (
          <ProactiveCallout key="proactive" queue={queue} onRemove={remove} onAsk={onAsk} />
        )}
      </AnimatePresence>
    </div>
  );
}

type Queue = ReturnType<typeof useNoticeQueue<ProactiveItem>>;

function ProactiveCallout({
  queue,
  onRemove,
  onAsk,
}: {
  queue: Queue;
  onRemove: (id: string) => void;
  onAsk: (prompt: string) => void;
}) {
  const t = useTranslations("jarvis.proactive");
  const tQueue = useTranslations("jarvis.queue");
  const reduceMotion = useReducedMotionSafe();
  const reaction = useProactiveReaction();
  const isPhone = useIsPhone();
  const [pose, setPose] = useState<JarvisState>("waving");
  const [happy, setHappy] = useState(0);
  const item = queue.current!;

  useEffect(() => {
    const timer = window.setTimeout(() => setPose("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!happy) return;
    const timer = window.setTimeout(() => setHappy(0), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [happy]);

  const close = () => {
    reaction.mutate({ id: item.id, reaction: "close" });
    onRemove(item.id);
  };

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 1, transition: { duration: 0.8 } }}
      className="pointer-events-auto absolute bottom-[calc(12px+64px+12px+env(safe-area-inset-bottom))] left-[max(16px,env(safe-area-inset-left))] flex w-[min(380px,calc(100vw-32px))] flex-col-reverse items-start gap-1 md:bottom-[max(24px,env(safe-area-inset-bottom))] md:left-[calc(--spacing(19)+env(safe-area-inset-left)+24px)] md:w-auto md:flex-row md:items-end md:gap-2 lg:left-[calc(--spacing(60)+env(safe-area-inset-left)+32px)]"
    >
      <Jarvis size={JARVIS_SIZES.bubble} state={happy ? "happy" : pose} enterFrom="left" />
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
        transition={reduceMotion ? { duration: 0 } : { delay: 0.6, duration: 0.25 }}
        role="group"
        aria-label={tQueue("label")}
        data-testid="jarvis-proactive"
        tabIndex={0}
        onKeyDown={queueKeyDown(queue.previous, queue.next)}
        className="w-full origin-bottom-left rounded-card outline-none focus-visible:ring-3 focus-visible:ring-teal/50 md:mb-10 md:w-[340px]"
      >
        <SpeechBubble
          tail={isPhone ? { side: "bottom", align: "start" } : { side: "left", align: "end" }}
          onClose={close}
          closeLabel={t("close")}
        >
          <div
            className={cn(
              "mb-1 flex items-center justify-between gap-2",
              queue.total > 1 && "-mt-2.5 mouse:-mt-1.5",
            )}
          >
            <p className="text-xs font-semibold tracking-wide text-teal uppercase">
              {t(`heading.${item.kind}`)}
            </p>
            <NoticePager
              index={queue.index}
              total={queue.total}
              onPrevious={queue.previous}
              onNext={queue.next}
              className="-my-1.5 -mr-2"
            />
          </div>
          <NoticeSlide
            itemKey={item.id}
            direction={queue.direction}
            swipe={isPhone && queue.total > 1}
            onPrevious={queue.previous}
            onNext={queue.next}
          >
            <ProactiveBody
              item={item}
              last={queue.total === 1}
              onRemove={onRemove}
              onAsk={onAsk}
              onDone={() => setHappy((value) => value + 1)}
            />
          </NoticeSlide>
        </SpeechBubble>
      </motion.div>
    </motion.div>
  );
}

/** What one notice says and the buttons for it; its own state goes with it. */
function ProactiveBody({
  item,
  last,
  onRemove,
  onAsk,
  onDone,
}: {
  item: ProactiveItem;
  /** The only one left: a done action shows its confirmation before Jarvis flies off. */
  last: boolean;
  onRemove: (id: string) => void;
  onAsk: (prompt: string) => void;
  /** An action went through. */
  onDone: () => void;
}) {
  const t = useTranslations("jarvis.proactive");
  const router = useRouter();
  const reaction = useProactiveReaction();
  const suggestionText = useSuggestionText();
  const [added, setAdded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [answer, setAnswer] = useState("");

  const react = (name: "open" | "later" | "close") => {
    reaction.mutate({ id: item.id, reaction: name });
    onRemove(item.id);
  };

  // Done leaves the queue at once; the last one says so first, then Jarvis flies off.
  const finished = () => {
    onDone();
    if (!last) {
      onRemove(item.id);
      return;
    }
    setAdded(true);
    window.setTimeout(() => onRemove(item.id), CONFIRM_MS);
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
      // The server never brings up a call outside the time window.
      notBefore: null,
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
        onSuccess: finished,
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
        onSuccess: finished,
        onError: () => setFailed(true),
      },
    );
  };

  const busy = reaction.isPending || added;

  return (
    <div>
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
    </div>
  );
}
