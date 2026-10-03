"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useFirstActiveMilestone } from "@/features/game/overview-queries";
import {
  findTourTarget,
  placeCallout,
  type Box,
  type Size,
  type TourStep,
} from "@/features/jarvis/tour";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { Jarvis, JARVIS_SIZES, type JarvisState } from "./jarvis";
import { SpeechBubble, TypedText, type BubbleTail } from "./speech-bubble";

const CHARACTER = JARVIS_SIZES.bubble;
/** Room around the lit element. */
const SPOT_PADDING = 8;
const BUBBLE_WIDTH = 300;

function sameBox(a: Box | null, b: Box | null) {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/** The lit element's box, kept current while the page scrolls or resizes. Zero sizes never count. */
function useTargetBox(target: string | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    let element: HTMLElement | null = null;
    let frame = 0;
    const measure = () => {
      frame = 0;
      element = target ? findTourTarget(target) : null;
      const rect = element?.getBoundingClientRect();
      const next =
        rect && rect.width > 0 && rect.height > 0
          ? {
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }
          : null;
      setBox((current) => (sameBox(current, next) ? current : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    if (element) observer.observe(element);
    observer.observe(document.documentElement);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    // The Jarvis button bobs; a slow re-measure keeps the light on it.
    const interval = window.setInterval(schedule, 500);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.clearInterval(interval);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [target]);
  return box;
}

function useViewport(): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

/**
 * The guided tour on screen: the rest of the page dims, the element Jarvis
 * talks about stays lit with soft edges, and Jarvis (140 px) stands next to
 * it with his bubble, Next / Skip and the progress dots. Between steps he
 * flies over to the next element. Escape or Skip ends it.
 */
export function TourOverlay({
  steps,
  onFinish,
}: {
  steps: TourStep[];
  onFinish: (how: "done" | "skipped") => void;
}) {
  const t = useTranslations("jarvis.tour");
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const isPhone = useIsPhone();
  const viewport = useViewport();
  const maskId = `tour-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const titleId = `${maskId}-title`;
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)]!;
  const last = index >= steps.length - 1;
  const box = useTargetBox(step.target);
  const firstMilestone = useFirstActiveMilestone(step.key === "finish");

  // The callout's real size decides where it fits; measured, never assumed zero.
  const calloutRef = useRef<HTMLDivElement>(null);
  const [callout, setCallout] = useState<Size>({
    width: CHARACTER + BUBBLE_WIDTH,
    height: CHARACTER + 160,
  });
  useLayoutEffect(() => {
    const element = calloutRef.current;
    if (!element) return;
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setCallout((current) =>
          current.width === width && current.height === height ? current : { width, height },
        );
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const placement = placeCallout(box, callout, viewport, CHARACTER);
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => primaryRef.current?.focus({ preventScroll: true }), [index]);

  const skip = useCallback(() => onFinish(last ? "done" : "skipped"), [onFinish, last]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skip]);

  const next = () => (last ? onFinish("done") : setIndex((value) => value + 1));

  // The last step suggests one first action.
  const firstAction =
    step.key === "workerFinish"
      ? { label: t("action.openTasks"), href: "/tasks" }
      : firstMilestone.data
        ? {
            label: t("action.openMilestone", { milestone: firstMilestone.data.title }),
            href: `/milestones/${firstMilestone.data.id}`,
          }
        : { label: t("action.createMilestone"), href: "/milestones" };

  const state: JarvisState =
    placement.side === "center" ? (last ? "happy" : "waving") : index === 0 ? "waving" : "pointing";

  // Phones stack Jarvis and the bubble; wider screens put them side by side.
  const below = placement.side !== "above";
  const tail: BubbleTail = isPhone
    ? { side: below ? "top" : "bottom", align: placement.flip ? "end" : "start" }
    : { side: placement.flip ? "right" : "left", align: below ? "start" : "end" };

  const spot = box && {
    x: box.left - SPOT_PADDING,
    y: box.top - SPOT_PADDING,
    width: box.width + SPOT_PADDING * 2,
    height: box.height + SPOT_PADDING * 2,
  };
  const fly = reduceMotion
    ? { duration: 0 }
    : ({ type: "spring", stiffness: 140, damping: 20, mass: 0.9 } as const);

  const textKey =
    step.key === "milestones" && steps.some((s) => s.key === "level")
      ? "milestones.textGame"
      : `${step.key}.text`;

  return (
    <div className="fixed inset-0 z-takeover" data-jarvis-tour>
      <svg aria-hidden className="absolute inset-0 size-full">
        <defs>
          <filter id={`${maskId}-soft`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {spot && (
              <motion.rect
                initial={false}
                animate={spot}
                transition={fly}
                rx={16}
                fill="black"
                filter={`url(#${maskId}-soft)`}
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" className="fill-black/55" mask={`url(#${maskId})`} />
        {spot && (
          <motion.rect
            initial={false}
            animate={spot}
            transition={fly}
            rx={16}
            fill="none"
            className="stroke-teal/60"
            strokeWidth={2}
          />
        )}
      </svg>

      <motion.div
        ref={calloutRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={false}
        animate={{ x: placement.left, y: placement.top }}
        transition={fly}
        className={cn(
          "absolute top-0 left-0 flex w-[min(360px,calc(100vw-32px))] gap-2 md:w-auto md:max-w-[calc(100vw-32px)] md:items-start",
          isPhone
            ? below
              ? "flex-col"
              : "flex-col-reverse"
            : placement.flip
              ? "flex-row-reverse"
              : "flex-row",
          !isPhone && !below && "md:items-end",
        )}
      >
        <div className={cn("shrink-0", isPhone && placement.flip && "self-end")}>
          <Jarvis
            size={CHARACTER}
            state={state}
            direction={placement.direction}
            enterFrom={index === 0 ? "bottom" : undefined}
          />
        </div>
        <SpeechBubble tail={tail} className="w-full md:w-[300px]">
          <h2 id={titleId} className="mb-1 text-sm font-semibold text-teal">
            {t(`steps.${step.key}.title`)}
          </h2>
          <TypedText key={step.key} text={t(`steps.${textKey}`)} />
          {last && (
            <Button
              variant="secondary"
              className="mt-3 w-full justify-start"
              onClick={() => {
                router.push(firstAction.href);
                onFinish("done");
              }}
            >
              {firstAction.label}
            </Button>
          )}
          <div className="mt-4 flex items-center gap-2">
            <ol
              aria-label={t("progress", { step: index + 1, total: steps.length })}
              className="flex flex-1 gap-1.5"
            >
              {steps.map((item, position) => (
                <li
                  key={item.key}
                  aria-current={position === index ? "step" : undefined}
                  className={cn(
                    "size-2 rounded-full transition-colors",
                    position === index
                      ? "bg-teal"
                      : position < index
                        ? "bg-teal/40"
                        : "bg-line-strong",
                  )}
                />
              ))}
            </ol>
            {!last && (
              <Button variant="ghost" size="sm" onClick={skip}>
                {t("skip")}
              </Button>
            )}
            <Button ref={primaryRef} size="sm" onClick={next}>
              {last ? t("done") : t("next")}
            </Button>
          </div>
        </SpeechBubble>
      </motion.div>
    </div>
  );
}
