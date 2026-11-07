"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CheckIcon, LightbulbIcon, LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Jarvis, JARVIS_SIZES, type JarvisState } from "@/components/jarvis/jarvis";
import { SpeechBubble, TypedText, type BubbleTail } from "@/components/jarvis/speech-bubble";
import { useTargetBox, useViewport } from "@/components/jarvis/tour-overlay";
import { Button } from "@/components/ui/button";
import { placeCallout, type Size } from "@/features/jarvis/tour";
import { usePageScrollLock } from "@/lib/scroll-lock";
import { useIsPhone, useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { canAdvance, highlightOf, hintDue, navigationFor, type PlannedStep } from "./engine";
import { useStepCheck } from "./queries";
import type { DemoResolution, RunningMode } from "./types";

const CHARACTER = JARVIS_SIZES.bubble;
/** Room around the lit element. */
const SPOT_PADDING = 8;

export type FirstAction = { label: string; href: string; target: string | null };

type OverlayProps = {
  mode: RunningMode;
  steps: PlannedStep[];
  index: number;
  /** When the tutorial began (the database's time): what the user did since counts. */
  since: string | null;
  /** Next or Skip step. */
  onMove: (index: number, how: "next" | "skip") => void;
  /** Walked to the end, or left on the way; the sample data kept or deleted (full only). */
  onEnd: (how: "finished" | "abandoned", demo: DemoResolution | null, href?: string) => void;
  /** The first real step suggested at the end. */
  firstAction: FirstAction;
  pending: boolean;
};

/** The last time the user did anything on the page: the hint waits for a pause. */
function useIdleSince(key: string, enabled: boolean) {
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setSince(Date.now());
    if (!enabled) return;
    const touch = () => setSince(Date.now());
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      for (const name of events) window.removeEventListener(name, touch);
      window.clearInterval(timer);
    };
  }, [key, enabled]);
  return { since, now };
}

/**
 * The tutorial on screen. A look step dims the page and lights the element
 * Jarvis talks about, with him next to it (as the former tour); a hands-on
 * step leaves the page free to use: only a ring around the element and his
 * bubble at the edge (below dialogs and sheets, so it never covers what the
 * user fills in), whose Next unlocks once the check passes. Every step can be
 * skipped, the tutorial ended at any time.
 */
export function TutorialOverlay(props: OverlayProps) {
  const { steps, index, onMove } = props;
  const step = steps[Math.min(index, steps.length - 1)]!;
  const router = useRouter();
  const pathname = usePathname();

  // A step opens its section when it begins; afterwards the user may go anywhere.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (opened.current === step.key) return;
    opened.current = step.key;
    const target = navigationFor(step, pathname);
    if (target) router.push(target);
  }, [step, pathname, router]);

  const passed = useStepCheck(step, props.since);
  const next = useCallback(() => onMove(index + 1, "next"), [onMove, index]);
  const skip = useCallback(() => onMove(index + 1, "skip"), [onMove, index]);

  return step.action === "look" ? (
    <LookLayer {...props} step={step} onNext={next} onSkip={skip} />
  ) : (
    <DoLayer {...props} step={step} passed={passed} onNext={next} onSkip={skip} />
  );
}

type LayerProps = OverlayProps & {
  step: PlannedStep;
  onNext: () => void;
  onSkip: () => void;
};

function LookLayer(props: LayerProps) {
  const { step, steps, index } = props;
  const reduceMotion = useReducedMotionSafe();
  const isPhone = useIsPhone();
  const viewport = useViewport();
  const maskId = `tutorial-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const titleId = `${maskId}-title`;
  const box = useTargetBox(highlightOf(step));
  const last = index >= steps.length - 1;
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [step.key]);

  const calloutRef = useRef<HTMLDivElement>(null);
  const [callout, setCallout] = useState<Size>({ width: CHARACTER + 300, height: CHARACTER + 160 });
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
  useEffect(() => primaryRef.current?.focus({ preventScroll: true }), [index, confirming]);

  // The overlay sits on the live page (not a Base UI dialog), so it holds the page's scroll itself.
  usePageScrollLock();

  const { onNext } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirming((value) => !value);
      } else if (event.key === "ArrowRight" && !last && !confirming) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, last, confirming]);

  const state: JarvisState =
    placement.side === "center" ? (last ? "happy" : "waving") : index === 0 ? "waving" : "pointing";
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

  return (
    <div className="fixed inset-0 z-takeover" data-jarvis-tour="" data-tutorial-overlay="look">
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
        <SpeechBubble tail={tail} className="w-full md:w-[320px]">
          <StepBody
            {...props}
            titleId={titleId}
            passed
            confirming={confirming}
            setConfirming={setConfirming}
            primaryRef={primaryRef}
          />
        </SpeechBubble>
      </motion.div>
    </div>
  );
}

function DoLayer(props: LayerProps & { passed: boolean }) {
  const { step, passed } = props;
  const t = useTranslations("tutorial");
  const box = useTargetBox(highlightOf(step));
  const reduceMotion = useReducedMotionSafe();
  const titleId = `tutorial-step-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [confirming, setConfirming] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setConfirming(false);
    setCollapsed(false);
  }, [step.key]);
  const primaryRef = useRef<HTMLButtonElement>(null);

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
          transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 22 }}
          className={cn(
            "pointer-events-none fixed z-nav rounded-2xl border-2 border-teal/70 shadow-[0_0_0_4px] shadow-teal/15",
            !passed && !reduceMotion && "animate-pulse",
          )}
        />
      )}
      <section
        aria-labelledby={titleId}
        data-jarvis-tour=""
        data-tutorial-overlay="do"
        data-capture-ignore=""
        className={cn(
          "fixed z-nav flex items-start gap-2",
          // Phone: at the top, clear of the bottom bar and the sheets; larger screens: bottom left of the content.
          "inset-x-2 top-[calc(env(safe-area-inset-top)+8px)]",
          "md:inset-x-auto md:top-auto md:bottom-6 md:left-[calc(var(--app-sidebar-width)+24px)] md:w-[380px]",
        )}
      >
        <div className="hidden shrink-0 md:block">
          <Jarvis size={56} state={passed ? "happy" : "pointing"} variant="head" />
        </div>
        <div className="min-w-0 flex-1 rounded-2xl border border-line-strong bg-surface/95 p-3 shadow-popover backdrop-blur-md">
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-semibold text-ink outline-none focus-visible:ring-3 focus-visible:ring-teal/50"
            >
              {passed ? (
                <CheckIcon aria-hidden className="size-4 text-green" />
              ) : (
                <LightbulbIcon aria-hidden className="size-4 text-gold" />
              )}
              <span className="min-w-0 flex-1 truncate" id={titleId}>
                {t(`steps.${step.key}.title`)}
              </span>
              <span className="text-xs font-normal text-ink-muted">{t("expand")}</span>
            </button>
          ) : (
            <StepBody
              {...props}
              titleId={titleId}
              confirming={confirming}
              setConfirming={setConfirming}
              primaryRef={primaryRef}
              onCollapse={() => setCollapsed(true)}
            />
          )}
        </div>
      </section>
    </>
  );
}

function StepBody({
  mode,
  step,
  steps,
  index,
  passed,
  onNext,
  onSkip,
  onEnd,
  firstAction,
  pending,
  titleId,
  confirming,
  setConfirming,
  primaryRef,
  onCollapse,
}: LayerProps & {
  passed: boolean;
  titleId: string;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  primaryRef: RefObject<HTMLButtonElement | null>;
  onCollapse?: () => void;
}) {
  const t = useTranslations("tutorial");
  const last = index >= steps.length - 1;
  const idle = useIdleSince(step.key, step.action === "do" && !passed);
  const showHint = step.action === "do" && hintDue(step, passed, idle.since, idle.now);
  const [demo, setDemo] = useState<DemoResolution | null>(null);

  if (confirming) {
    return (
      <EndConfirm
        mode={mode}
        titleId={titleId}
        pending={pending}
        primaryRef={primaryRef}
        onCancel={() => setConfirming(false)}
        onEnd={(resolution) => onEnd("abandoned", resolution)}
      />
    );
  }

  const header = (
    <div className="mb-1 flex items-center justify-between gap-2">
      <p className="text-xs text-ink-muted">
        {t(`chapters.${step.chapter}`)} ·{" "}
        {t("progress", { step: index + 1, total: steps.length })}
      </p>
      {onCollapse && (
        <button
          type="button"
          onClick={onCollapse}
          className="-my-2 -mr-1 min-h-11 rounded-full px-2 text-xs text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-teal/50 mouse:min-h-8"
        >
          {t("collapse")}
        </button>
      )}
    </div>
  );

  return (
    <div>
      {header}
      <h2 id={titleId} className="mb-1 text-sm font-semibold text-teal">
        {t(`steps.${step.key}.title`)}
      </h2>
      {step.action === "look" ? (
        <TypedText key={step.key} text={t(step.jarvisSays)} />
      ) : (
        <p className="text-[15px] leading-relaxed text-ink">{t(step.jarvisSays)}</p>
      )}
      {step.locked && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-muted">
          <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {t("locked")}
        </p>
      )}
      {step.action === "do" &&
        (passed ? (
          <p role="status" className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-green">
            <CheckIcon aria-hidden className="size-4" />
            {t("checkPassed")}
          </p>
        ) : showHint ? (
          <p role="status" className="mt-2 flex items-start gap-1.5 text-sm text-gold">
            <LightbulbIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t(step.hint)}
          </p>
        ) : null)}

      {last && (
        <FinishPart
          mode={mode}
          demo={demo}
          setDemo={setDemo}
          firstAction={firstAction}
          pending={pending}
          onOpen={() => onEnd("finished", demo, firstAction.href)}
        />
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-1.5">
        {!last && (
          <Button variant="ghost" size="sm" className="mr-auto" onClick={() => setConfirming(true)}>
            {t("end")}
          </Button>
        )}
        {!last && step.skippable && step.action === "do" && !passed && (
          <Button variant="ghost" size="sm" onClick={onSkip}>
            {t("skipStep")}
          </Button>
        )}
        {!last && step.action === "look" && (
          <Button variant="ghost" size="sm" onClick={onSkip}>
            {t("skipStep")}
          </Button>
        )}
        <Button
          ref={primaryRef}
          size="sm"
          disabled={pending || (last ? mode === "full" && !demo : !canAdvance(step, passed))}
          onClick={() => (last ? onEnd("finished", demo) : onNext())}
        >
          {last ? t("done") : t("next")}
        </Button>
      </div>
    </div>
  );
}

function FinishPart({
  mode,
  demo,
  setDemo,
  firstAction,
  pending,
  onOpen,
}: {
  mode: RunningMode;
  demo: DemoResolution | null;
  setDemo: (value: DemoResolution) => void;
  firstAction: FirstAction;
  pending: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("tutorial");
  return (
    <div className="mt-3 flex flex-col gap-3">
      {mode === "full" && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-semibold text-ink">{t("demo.question")}</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {(["deleted", "kept"] as const).map((value) => (
              <Choice key={value} checked={demo === value} onSelect={() => setDemo(value)}>
                {t(`demo.${value}`)}
              </Choice>
            ))}
          </div>
          <p className="text-xs text-ink-muted">{t("demo.footnote")}</p>
        </fieldset>
      )}
      <div>
        <p className="text-sm text-ink-muted">{t("firstStep")}</p>
        {firstAction.target && (
          <p className="truncate text-sm font-semibold text-ink">
            {t("firstStepTarget", { milestone: firstAction.target })}
          </p>
        )}
        <Button
          variant="secondary"
          className="mt-1.5 w-full justify-start"
          disabled={pending || (mode === "full" && !demo)}
          onClick={onOpen}
        >
          {firstAction.label}
        </Button>
      </div>
    </div>
  );
}

function Choice({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onSelect}
      className={cn(
        "min-h-11 rounded-xl border px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-teal/50",
        checked
          ? "border-teal bg-teal/15 text-ink"
          : "border-line-strong text-ink-soft hover:bg-surface-hover",
      )}
    >
      {children}
    </button>
  );
}

function EndConfirm({
  mode,
  titleId,
  pending,
  primaryRef,
  onCancel,
  onEnd,
}: {
  mode: RunningMode;
  titleId: string;
  pending: boolean;
  primaryRef: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onEnd: (demo: DemoResolution | null) => void;
}) {
  const t = useTranslations("tutorial");
  return (
    <div>
      <h2 id={titleId} className="mb-1 text-sm font-semibold text-teal">
        {t("endConfirm.title")}
      </h2>
      <p className="text-[15px] leading-relaxed text-ink">
        {t(mode === "full" ? "endConfirm.textFull" : "endConfirm.text")}
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-1.5">
        <Button ref={primaryRef} variant="ghost" size="sm" onClick={onCancel}>
          {t("endConfirm.back")}
        </Button>
        {mode === "full" ? (
          <>
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => onEnd("kept")}>
              {t("endConfirm.keep")}
            </Button>
            <Button size="sm" disabled={pending} onClick={() => onEnd("deleted")}>
              {t("endConfirm.delete")}
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={pending} onClick={() => onEnd(null)}>
            {t("end")}
          </Button>
        )}
      </div>
    </div>
  );
}
