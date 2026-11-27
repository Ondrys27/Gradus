"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { CheckIcon, EyeOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Grady, GRADY_SIZES, type GradyState } from "@/components/grady/grady";
import { SpeechBubble, type BubbleTail } from "@/components/grady/speech-bubble";
import { useTargetBox, useViewport } from "@/components/grady/tour-overlay";
import { Button } from "@/components/ui/button";
import { findFirstTarget, findTourTarget, placeCallout, type Size } from "@/features/grady/tour";
import { useIsPhone, useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { StepText } from "../tutorial-text";
import type { GuideRun } from "./guide-store";
import { isLook, navigationFor, stepDone, type GuideStep, type ScreenState } from "./player";
import { pressElement } from "./press";

const CHARACTER = GRADY_SIZES.bubble;
const SPOT_PADDING = 8;
/** How long a lit element may be missing before Grady says he cannot see it. */
const MISSING_AFTER_MS = 2500;
/** A done step moves on by itself after a short "good". */
const ADVANCE_MS = 900;

type Flags = Omit<ScreenState, "pathname" | "search">;
const NO_FLAGS: Flags = { pressed: false, typed: false, nextVisible: false, targetGone: false, saved: false };

/**
 * What the screen says about the step (player.ts decides from it): whether
 * the user pressed or typed into the lit element, whether what it opens is
 * there, whether the element went away and whether the app saved anything.
 */
function useScreenFlags(step: GuideStep): { flags: Flags; present: boolean; missing: boolean } {
  const queryClient = useQueryClient();
  const [flags, setFlags] = useState<Flags>(NO_FLAGS);
  const [present, setPresent] = useState(false);
  const [missing, setMissing] = useState(false);
  const seen = useRef(false);

  useEffect(() => {
    setFlags(NO_FLAGS);
    setPresent(false);
    setMissing(false);
    seen.current = false;
    const started = Date.now();
    const raise = (patch: Partial<Flags>) =>
      setFlags((current) => {
        const next = { ...current, ...patch };
        return Object.keys(patch).every((key) => current[key as keyof Flags] === next[key as keyof Flags])
          ? current
          : next;
      });
    const within = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      const lit = findFirstTarget(step.highlight);
      return Boolean(lit && (lit === target || lit.contains(target)));
    };
    const onPress = (event: Event) => {
      if (within(event.target)) raise({ pressed: true });
    };
    const onInput = (event: Event) => {
      if (within(event.target)) raise({ typed: true });
    };
    document.addEventListener("click", onPress, true);
    document.addEventListener("input", onInput, true);
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || event.mutation.state.status !== "success") return;
      // The guide's own settings are no work of the user.
      if ((event.mutation.options.meta as { guide?: boolean } | undefined)?.guide) return;
      raise({ saved: true });
    });
    const poll = window.setInterval(() => {
      const here = step.highlight.length > 0 && findFirstTarget(step.highlight) !== null;
      if (here) seen.current = true;
      setPresent(here);
      setMissing(step.highlight.length > 0 && !here && !seen.current && Date.now() - started > MISSING_AFTER_MS);
      raise({
        targetGone: seen.current && !here,
        nextVisible: Boolean(step.nextKey && findTourTarget(step.nextKey)),
      });
    }, 300);
    return () => {
      document.removeEventListener("click", onPress, true);
      document.removeEventListener("input", onInput, true);
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [step, queryClient]);
  return { flags, present, missing };
}

export type GuideOverlayProps = {
  run: GuideRun;
  /** Next (or moved on by itself when done); `forMe` when Grady did the step. */
  onNext: (forMe?: boolean) => void;
  onEnd: (how: "finished" | "abandoned") => void;
  onAskMore: () => void;
  onDoneForMe: (step: GuideStep) => void;
};

/**
 * Grady's guide on screen (30.8), the same way the tutorial shows itself: a
 * step that only shows dims the page and lights the element with Grady
 * beside it; a step the user does leaves the page free, with a ring around
 * the element, Grady next to it and his bubble at the edge, and goes on by
 * itself once the screen says it is done. Next · Do it for me (only where
 * Grady may: leading to a page, pressing what only opens something) · Ask
 * more · End.
 */
export function GuideOverlay(props: GuideOverlayProps) {
  const { run, onNext } = props;
  const step = run.steps[Math.min(run.index, run.steps.length - 1)]!;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { flags, present, missing } = useScreenFlags(step);
  const done = stepDone(step, { ...flags, pathname, search });
  const look = isLook(step.action);

  // A step on another page opens it when it begins; afterwards the user may go anywhere.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (opened.current === step.id) return;
    opened.current = step.id;
    const target = navigationFor(step, pathname, search);
    if (target) router.push(target);
  }, [step, pathname, search, router]);

  // What the user does moves the guide on (a look waits for Next).
  useEffect(() => {
    if (look || !done) return;
    const timer = window.setTimeout(() => onNext(), ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [look, done, onNext, step.id]);

  return look ? (
    <LookLayer {...props} step={step} missing={missing} />
  ) : (
    <DoLayer {...props} step={step} done={done} present={present} missing={missing} />
  );
}

function useStepTexts(step: GuideStep) {
  const t = useTranslations("tutorial");
  const name = t.has(step.titleKey as never) ? t(step.titleKey as never) : "";
  // A go step's title is its section's name, which its text names too.
  const values = { name, section: name };
  const text =
    step.say ??
    (step.textKey && t.has(step.textKey as never)
      ? t(step.textKey as never, values as never)
      : t(`guide.actions.${step.action}`, { name }));
  return { title: name, text };
}

type LayerProps = GuideOverlayProps & { step: GuideStep; missing: boolean };

function LookLayer(props: LayerProps) {
  const { run, step, missing } = props;
  const reduceMotion = useReducedMotionSafe();
  const isPhone = useIsPhone();
  const viewport = useViewport();
  const maskId = `guide-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const box = useTargetBox(step.highlight);
  const { title } = useStepTexts(step);
  const calloutRef = useRef<HTMLDivElement>(null);
  const [callout, setCallout] = useState<Size>({ width: CHARACTER + 300, height: CHARACTER + 160 });
  useLayoutEffect(() => {
    const element = calloutRef.current;
    if (!element) return;
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setCallout((current) => (current.width === width && current.height === height ? current : { width, height }));
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const placement = placeCallout(box, callout, viewport, CHARACTER);
  const last = run.index >= run.steps.length - 1;
  const { onNext, onEnd } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEnd("abandoned");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (last) onEnd("finished");
        else onNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, onEnd, last]);

  const state: GradyState = placement.side === "center" ? (last ? "happy" : "waving") : "pointing";
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
  const fly = reduceMotion ? { duration: 0 } : ({ type: "spring", stiffness: 140, damping: 20, mass: 0.9 } as const);

  return (
    <div
      className="fixed inset-0 z-takeover"
      data-grady-tour=""
      data-guide-overlay="look"
      data-guide-step={step.key}
      data-capture-ignore=""
    >
      <svg aria-hidden className="absolute inset-0 size-full">
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {spot && <motion.rect initial={false} animate={spot} transition={fly} rx={16} fill="black" />}
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
      <Progress run={run} />
      <motion.div
        ref={calloutRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || undefined}
        initial={false}
        animate={{ x: placement.left, y: placement.top }}
        transition={fly}
        className={cn(
          "absolute top-0 left-0 flex w-[min(360px,calc(100vw-32px))] gap-2 md:w-auto md:max-w-[calc(100vw-32px)] md:items-start",
          isPhone ? (below ? "flex-col" : "flex-col-reverse") : placement.flip ? "flex-row-reverse" : "flex-row",
        )}
      >
        <div className={cn("shrink-0", isPhone && placement.flip && "self-end")}>
          <Grady size={CHARACTER} state={state} direction={placement.direction} />
        </div>
        <SpeechBubble tail={tail} className="w-full md:w-[320px]">
          <StepBody {...props} done missing={missing} />
        </SpeechBubble>
      </motion.div>
    </div>
  );
}

function DoLayer(props: LayerProps & { done: boolean; present: boolean }) {
  const { step, done, run } = props;
  const box = useTargetBox(step.highlight);
  const reduceMotion = useReducedMotionSafe();
  const spring = reduceMotion ? { duration: 0 } : ({ type: "spring", stiffness: 160, damping: 22 } as const);
  const { onEnd } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[role=dialog][data-open], [role=dialog][data-state=open]")) {
        onEnd("abandoned");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnd]);
  return (
    <>
      {box && (
        <motion.div
          aria-hidden
          data-capture-ignore=""
          initial={false}
          animate={{
            top: box.top - SPOT_PADDING,
            left: box.left - SPOT_PADDING,
            width: box.width + SPOT_PADDING * 2,
            height: box.height + SPOT_PADDING * 2,
          }}
          transition={spring}
          className={cn(
            "pointer-events-none fixed z-nav rounded-2xl border-2 shadow-[0_0_0_4px] transition-colors duration-300",
            done ? "border-green/80 shadow-green/15" : "border-teal/70 shadow-teal/15",
            !done && !reduceMotion && "animate-pulse",
          )}
        />
      )}
      <section
        data-grady-tour=""
        data-guide-overlay="do"
        data-guide-step={step.key}
        data-capture-ignore=""
        aria-live="polite"
        className={cn(
          "fixed z-nav flex items-end gap-2",
          "inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+76px)] md:inset-x-auto md:bottom-6 md:left-[calc(var(--app-sidebar-width,0px)+24px)] md:w-[380px]",
          box && box.top > window.innerHeight / 2 && "max-md:top-[calc(env(safe-area-inset-top)+16px)] max-md:bottom-auto",
        )}
      >
        <div className="hidden shrink-0 md:block">
          <Grady size={56} state={done ? "happy" : "pointing"} variant="head" />
        </div>
        <div className="min-w-0 flex-1 rounded-2xl border border-line-strong bg-surface/95 p-3 shadow-popover md:backdrop-blur-md">
          <Progress run={run} inline />
          <StepBody {...props} />
        </div>
      </section>
    </>
  );
}

function StepBody({
  run,
  step,
  done,
  missing,
  onNext,
  onEnd,
  onAskMore,
  onDoneForMe,
}: LayerProps & { done: boolean }) {
  const t = useTranslations("tutorial");
  const { title, text } = useStepTexts(step);
  const last = run.index >= run.steps.length - 1;
  const look = isLook(step.action);
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (look) primaryRef.current?.focus({ preventScroll: true });
  }, [look, step.id]);
  return (
    <div data-testid="guide-step" data-guide-action={step.action}>
      {title && <h2 className="mb-1 text-sm font-semibold text-teal">{title}</h2>}
      <StepText key={step.id} text={text} typed={look} />
      {missing && (
        <p role="status" className="mt-2 flex items-start gap-1.5 text-sm text-ink-muted">
          <EyeOffIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("guide.missingTarget")}
        </p>
      )}
      {!look && (
        <p role="status" className={cn("mt-2 flex items-center gap-1.5 text-xs", done ? "text-green" : "text-ink-muted")}>
          {done ? <CheckIcon aria-hidden className="size-3.5" /> : null}
          {done ? t("guide.stepDone") : t(`guide.waiting.${step.action}`)}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
        <Button variant="ghost" size="sm" className="mr-auto" onClick={() => onEnd("abandoned")} data-testid="guide-end">
          {t("guide.end")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onAskMore} data-testid="guide-ask-more">
          {t("guide.askMore")}
        </Button>
        {step.doable && !done && (
          <Button variant="secondary" size="sm" onClick={() => onDoneForMe(step)} data-testid="guide-do-for-me">
            {t("guide.doForMe")}
          </Button>
        )}
        <Button
          ref={primaryRef}
          size="sm"
          data-testid="guide-next"
          onClick={() => (last ? onEnd("finished") : onNext())}
        >
          {last ? t("guide.finish") : t("guide.next")}
        </Button>
      </div>
    </div>
  );
}

function Progress({ run, inline = false }: { run: GuideRun; inline?: boolean }) {
  const share = run.steps.length > 1 ? (run.index + 1) / run.steps.length : 1;
  return (
    <div
      aria-hidden
      className={cn(
        inline ? "mb-2 h-1 w-full overflow-hidden rounded-full bg-line" : "absolute inset-x-0 top-0 h-1 bg-line/60",
      )}
    >
      <div className="h-full bg-teal transition-[width] duration-300" style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

/** "Do it for me" on a step: lead to its page, or press the element (opening something only). */
export function doStepForMe(step: GuideStep, push: (path: string) => void): boolean {
  if (step.action === "go") {
    push(step.path);
    return true;
  }
  const element = findFirstTarget(step.highlight);
  if (!element) {
    if (step.path) push(step.path);
    return false;
  }
  pressElement(element);
  return true;
}
