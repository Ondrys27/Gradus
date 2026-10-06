"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { CalendarPlusIcon, RadarIcon, ScanSearchIcon, TagIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Jarvis } from "@/components/jarvis/jarvis";
import {
  chatFrameAt,
  chatTimeline,
  finalChatFrame,
  sameFrame,
  type ChatFrame,
} from "./chat-timeline";
import { Reveal, RevealGroup, RevealItem } from "./reveal";
import { useReducedMotionSafe } from "./scroll-effects";

const POINTS = [
  { key: "knows", icon: ScanSearchIcon },
  { key: "watches", icon: RadarIcon },
  { key: "advises", icon: TagIcon },
] as const;

/** 5. Jarvis himself, his eyes on the cursor, next to a chat that plays itself. */
export function JarvisShowcase() {
  const t = useTranslations("marketing.home.jarvis");
  const question = t("chat.question");
  const answer = t("chat.answer");
  const chatRef = useRef<HTMLElement>(null);
  const inView = useInView(chatRef, { margin: "-15% 0px" });
  const reduce = useReducedMotionSafe();
  const frame = useChatFrame(question.length, answer.length, inView && !reduce);
  const shown = reduce ? finalChatFrame(question.length, answer.length) : frame;

  return (
    <section
      aria-labelledby="jarvis-title"
      className="mx-auto w-full max-w-6xl px-4 py-24 md:px-8 md:py-36"
    >
      <div className="grid items-center gap-12 md:grid-cols-[2fr_3fr] md:gap-16">
        <Reveal className="flex flex-col items-center gap-6 text-center md:items-start md:text-left">
          <div className="relative">
            <div
              aria-hidden
              className="absolute inset-[15%] -z-10 rounded-full bg-teal/30 blur-[60px]"
            />
            <Jarvis size={220} state={shown.thinking ? "thinking" : "idle"} />
          </div>
          <h2
            id="jarvis-title"
            className="text-4xl font-bold tracking-tight text-balance text-ink md:text-5xl"
          >
            {t("title")}
          </h2>
          <p className="max-w-md text-lg text-pretty text-ink-soft">{t("subtitle")}</p>
        </Reveal>

        <Reveal delay={0.15}>
          <figure
            ref={chatRef}
            className="flex flex-col overflow-hidden rounded-2xl border border-line-strong/70 bg-surface/90 shadow-glow-strong"
          >
            <figcaption className="flex items-center gap-3 border-b border-line/60 px-5 py-3">
              <span className="relative grid size-8 place-items-center rounded-full bg-teal/15">
                <Jarvis size={28} variant="head" />
              </span>
              <span className="font-semibold text-ink">{t("chat.name")}</span>
              <span className="ml-auto text-sm text-ink-muted">{t("chat.caption")}</span>
            </figcaption>

            {/* Screen readers get the whole conversation at once. */}
            <div className="sr-only">
              <p>{t("chat.line", { who: t("chat.you"), text: question })}</p>
              <p>{t("chat.line", { who: t("chat.name"), text: answer })}</p>
            </div>

            <motion.div
              aria-hidden
              animate={{ opacity: shown.fading ? 0 : 1 }}
              transition={{ duration: 0.45 }}
              className="flex min-h-[22rem] flex-col justify-end gap-4 p-5 md:min-h-[24rem] md:p-6"
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
                    {t("chat.action")}
                  </motion.span>
                </div>
              )}
            </motion.div>
          </figure>
        </Reveal>
      </div>

      <RevealGroup className="mt-16 grid gap-4 sm:grid-cols-3">
        {POINTS.map(({ key, icon: Icon }) => (
          <RevealItem
            key={key}
            className="flex items-center gap-3 rounded-card border border-line bg-surface/70 px-5 py-4"
          >
            <Icon aria-hidden className="size-5 shrink-0 text-teal" />
            <span className="font-medium text-ink">{t(`points.${key}`)}</span>
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
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
