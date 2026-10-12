"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { CalendarPlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Jarvis } from "@/components/jarvis/jarvis";
import { cn } from "@/lib/utils";
import {
  chatFrameAt,
  chatTimeline,
  finalChatFrame,
  sameFrame,
  type ChatFrame,
} from "./chat-timeline";
import { useReducedMotionSafe } from "./scroll-effects";

/**
 * A conversation with Jarvis that plays itself while it is on screen: the
 * question is typed, he thinks, the answer streams in and ends with the one
 * action he offers. It is the one moving thing in the Jarvis story, because
 * it shows what he actually does.
 */
export function JarvisChat({ className }: { className?: string }) {
  const t = useTranslations("marketing.home.stories.jarvis.chat");
  const question = t("question");
  const answer = t("answer");
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { margin: "-15% 0px" });
  const reduce = useReducedMotionSafe();
  const frame = useChatFrame(question.length, answer.length, inView && !reduce);
  const shown = reduce ? finalChatFrame(question.length, answer.length) : frame;

  return (
    <figure
      ref={ref}
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-line-strong/70 bg-surface shadow-popover",
        className,
      )}
    >
      <figcaption className="flex items-center gap-3 border-b border-line/60 px-5 py-3">
        <Jarvis size={34} variant="head" state={shown.thinking ? "thinking" : "idle"} />
        <span className="font-semibold text-ink">{t("name")}</span>
        <span className="ml-auto text-sm text-ink-muted">{t("caption")}</span>
      </figcaption>

      {/* Screen readers get the whole conversation at once. */}
      <div className="sr-only">
        <p>{t("line", { who: t("you"), text: question })}</p>
        <p>{t("line", { who: t("name"), text: answer })}</p>
      </div>

      <motion.div
        aria-hidden
        animate={{ opacity: shown.fading ? 0 : 1 }}
        transition={{ duration: 0.45 }}
        className="flex min-h-[21rem] flex-col justify-end gap-4 p-5"
      >
        {shown.userChars > 0 && (
          <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-violet px-4 py-3 text-white">
            {question.slice(0, shown.userChars)}
            {shown.userChars < question.length && <Caret />}
          </p>
        )}
        {shown.thinking && <ThinkingDots />}
        {shown.replyChars > 0 && (
          <div className="flex max-w-[92%] flex-col gap-3 self-start rounded-2xl rounded-bl-md border border-line bg-canvas-deep/80 px-4 py-3 text-ink-soft">
            <p>
              {answer.slice(0, shown.replyChars)}
              {shown.replyChars < answer.length && <Caret />}
            </p>
            <motion.span
              initial={false}
              animate={{ opacity: shown.showAction ? 1 : 0, y: shown.showAction ? 0 : 6 }}
              transition={{ duration: 0.3 }}
              className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl border border-teal/50 bg-teal/10 px-4 text-sm font-medium text-teal"
            >
              <CalendarPlusIcon className="size-4" />
              {t("action")}
            </motion.span>
          </div>
        )}
      </motion.div>
    </figure>
  );
}

function Caret() {
  return (
    <span className="ml-0.5 inline-block h-[1.1em] w-0.5 translate-y-[0.2em] animate-pulse bg-current" />
  );
}

function ThinkingDots() {
  return (
    <span className="flex gap-1.5 self-start rounded-2xl rounded-bl-md border border-line bg-canvas-deep/80 px-4 py-4">
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="size-2 rounded-full bg-teal"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: dot * 0.15 }}
        />
      ))}
    </span>
  );
}

/**
 * The chat's clock: runs on animation frames only while the chat is on
 * screen, and re-renders only when something visible changes.
 */
function useChatFrame(userLength: number, replyLength: number, running: boolean): ChatFrame {
  const [frame, setFrame] = useState<ChatFrame>(() =>
    chatFrameAt(0, chatTimeline(userLength, replyLength), userLength, replyLength),
  );
  const elapsed = useRef(0);

  useEffect(() => {
    if (!running) return;
    const timeline = chatTimeline(userLength, replyLength);
    let last = performance.now();
    let id = requestAnimationFrame(function tick(now) {
      elapsed.current += now - last;
      last = now;
      const next = chatFrameAt(elapsed.current, timeline, userLength, replyLength);
      setFrame((current) => (sameFrame(current, next) ? current : next));
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [running, userLength, replyLength]);

  return frame;
}
