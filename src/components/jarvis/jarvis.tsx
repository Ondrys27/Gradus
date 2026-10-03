"use client";

import { memo, useEffect, useId, useRef, useState } from "react";
import {
  motion,
  useInView,
  useReducedMotionConfig,
  useSpring,
  type TargetAndTransition,
  type Transition,
  type Variants,
} from "framer-motion";
import { cn } from "@/lib/utils";
import {
  lookToward,
  nextBlinkDelay,
  nextTiltDelay,
  poseFor,
  type JarvisDirection,
  type JarvisState,
} from "./jarvis-pose";
import { subscribePointer } from "./pointer-store";

export type { JarvisDirection, JarvisState } from "./jarvis-pose";
export { JARVIS_DIRECTIONS, JARVIS_SIZES, JARVIS_STATES } from "./jarvis-pose";

/** Full robot, or just the head with its display (the corner button, small headers). */
export type JarvisVariant = "full" | "head";
export type JarvisEntrance = "left" | "right" | "top" | "bottom";

type JarvisProps = {
  /** Rendered width and height in px. Designed for 64, 140 and 240 (`JARVIS_SIZES`). */
  size?: number;
  state?: JarvisState;
  /** Where the arm points in the `pointing` state. */
  direction?: JarvisDirection;
  variant?: JarvisVariant;
  /**
   * Fly in from this edge on mount and back out the same way on unmount. The exit
   * needs a surrounding `AnimatePresence`, and an ancestor that clips overflow.
   */
  enterFrom?: JarvisEntrance;
  className?: string;
};

const VIEWBOX: Record<JarvisVariant, string> = {
  full: "0 0 120 120",
  head: "10 -11 100 100",
};

const EYES = [49, 71] as const;
const EYE_Y = 47;

const OFFSCREEN: Record<
  JarvisEntrance,
  { x: string | number; y: string | number; rotate: number }
> = {
  left: { x: "-100vw", y: 0, rotate: 24 },
  right: { x: "100vw", y: 0, rotate: -24 },
  top: { x: 0, y: "-100vh", rotate: 10 },
  bottom: { x: 0, y: "100vh", rotate: -10 },
};

const flyIn = { duration: 0.75, ease: [0.16, 1, 0.3, 1] } as const;
const flyOut = { duration: 0.55, ease: [0.7, 0, 0.84, 0], delay: 0.15 } as const;
const landing = { duration: 1.05, times: [0, 0.6, 0.72, 0.87, 1] };

const entrance: Variants = {
  away: (from: JarvisEntrance) => ({ ...OFFSCREEN[from], scaleX: 1, scaleY: 1 }),
  here: {
    x: 0,
    y: 0,
    rotate: 0,
    scaleX: [1, 1, 1.16, 0.95, 1],
    scaleY: [1, 1, 0.82, 1.05, 1],
    transition: {
      x: flyIn,
      y: flyIn,
      rotate: { type: "spring", stiffness: 110, damping: 9, delay: 0.1 },
      scaleX: landing,
      scaleY: landing,
    },
  },
  leave: (from: JarvisEntrance) => ({
    ...OFFSCREEN[from],
    rotate: -OFFSCREEN[from].rotate,
    scaleX: [1, 1.12, 0.92],
    scaleY: [1, 0.86, 1.1],
    transition: {
      x: flyOut,
      y: flyOut,
      rotate: { duration: 0.6, delay: 0.1, ease: "easeIn" },
      scaleX: { duration: 0.3 },
      scaleY: { duration: 0.3 },
    },
  }),
};

/** One happy hop: crouch (squash), launch (stretch), land, settle. */
const HOP: Transition = {
  duration: 0.9,
  times: [0, 0.18, 0.5, 0.8, 1],
  ease: "easeOut",
  repeat: Infinity,
  repeatDelay: 1.2,
};

const fillBox = (originX: number, originY: number) =>
  ({ transformBox: "fill-box", originX, originY }) as const;

/**
 * Jarvis, a small hovering robot drawn as layered inline SVG. Only transforms and
 * opacity are animated; loops pause when he is off screen, and with reduced
 * motion every state is a still pose.
 */
export const Jarvis = memo(function Jarvis({
  size = 140,
  state = "idle",
  direction = "right",
  variant = "full",
  enterFrom,
  className,
}: JarvisProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ref = (suffix: string) => `jv${uid}-${suffix}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { margin: "80px" });
  const reduce = useReducedMotionConfig() ?? false;
  const live = inView && !reduce;
  const full = variant === "full";
  const pose = poseFor(state, direction);

  const blinking = useBlink(live && pose.eyes === "open");
  const tilt = useIdleTilt(live && state === "idle");

  // Eyes: follow the pointer in idle, otherwise look where the pose says.
  const lookX = useSpring(0, { stiffness: 150, damping: 18, mass: 0.6 });
  const lookY = useSpring(0, { stiffness: 150, damping: 18, mass: 0.6 });
  const { x: poseLookX, y: poseLookY } = pose.eyeLook;
  useEffect(() => {
    if (reduce) {
      lookX.jump(poseLookX);
      lookY.jump(poseLookY);
      return;
    }
    lookX.set(poseLookX);
    lookY.set(poseLookY);
    if (!pose.trackPointer || !live) return;
    return subscribePointer((x, y) => {
      const element = rootRef.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      const look = lookToward(
        x - (box.left + box.width / 2),
        y - (box.top + box.height * (full ? 0.38 : 0.5)),
        Math.max(240, box.width * 3),
      );
      lookX.set(look.x);
      lookY.set(look.y);
    });
  }, [pose.trackPointer, poseLookX, poseLookY, live, reduce, full, lookX, lookY]);

  const still: Transition = { duration: 0 };
  const spring: Transition = reduce ? still : { type: "spring", stiffness: 240, damping: 20 };
  const soft: Transition = reduce ? still : { type: "spring", stiffness: 110, damping: 14 };
  const fade: Transition = reduce ? still : { duration: 0.2, ease: "easeOut" };
  const amp = size * 0.045;
  const sleeping = state === "sleeping";

  // Hover, on its own compositor layer.
  const hover = live && full;
  const floatLoop: Transition = { duration: sleeping ? 5 : 3, ease: "easeInOut", repeat: Infinity };

  const shadow: { animate: TargetAndTransition; transition: Transition } = !hover
    ? { animate: { scaleX: 1, opacity: 0.5 }, transition: spring }
    : state === "happy"
      ? {
          animate: { scaleX: [1, 1.1, 0.6, 1.05, 1], opacity: [0.5, 0.6, 0.22, 0.5, 0.5] },
          transition: HOP,
        }
      : {
          animate: sleeping
            ? { scaleX: [1, 0.94, 1], opacity: [0.5, 0.42, 0.5] }
            : { scaleX: [1, 0.8, 1], opacity: [0.55, 0.3, 0.55] },
          transition: floatLoop,
        };

  const body = bodyMotion(state, live, amp, pose.lean, spring);

  // Antenna glow: slow pulse, quick blink while thinking, dim while asleep.
  const glow = pose.antennaGlow;
  const antennaGlow: { animate: TargetAndTransition; transition: Transition } = !live
    ? { animate: { opacity: glow }, transition: fade }
    : state === "thinking"
      ? {
          animate: { opacity: [0.15, 1, 0.15] },
          transition: { duration: 0.55, repeat: Infinity, ease: "easeInOut" },
        }
      : {
          animate: { opacity: [glow * 0.45, glow, glow * 0.45] },
          transition: { duration: sleeping ? 4.2 : 2.6, repeat: Infinity, ease: "easeInOut" },
        };

  // The arm raised higher is the one pointing.
  const pointsLeft = state === "pointing" && pose.leftArm > -pose.rightArm;
  const leftArm = armMotion(pose.leftArm, pointsLeft ? "tap" : null, live, spring);
  const rightArm = armMotion(
    pose.rightArm,
    state === "waving" ? "wave" : state === "pointing" && !pointsLeft ? "tap" : null,
    live,
    spring,
  );

  const eyeScaleY = blinking ? 0.08 : pose.eyeScaleY;
  const eyeTransition: Transition = reduce
    ? still
    : blinking
      ? { duration: 0.07, ease: "easeIn" }
      : { type: "spring", stiffness: 420, damping: 26 };

  return (
    <motion.div
      ref={rootRef}
      aria-hidden
      className={cn("relative shrink-0 select-none", className)}
      style={{ width: size, height: size, originY: 0.9 }}
      custom={enterFrom}
      variants={enterFrom ? entrance : undefined}
      initial={enterFrom && !reduce ? "away" : false}
      animate={enterFrom ? "here" : undefined}
      exit={enterFrom ? (reduce ? { opacity: 0, transition: still } : "leave") : undefined}
    >
      {full && (
        <motion.div
          className="absolute top-[87%] left-[29%] h-[6%] w-[42%] rounded-full bg-radial from-black/80 to-transparent to-70%"
          initial={false}
          animate={shadow.animate}
          transition={shadow.transition}
        />
      )}
      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={hover ? { y: sleeping ? [0, -amp * 0.4, 0] : [0, -amp, 0] } : { y: 0 }}
        transition={hover ? floatLoop : spring}
      >
        <motion.div
          className="absolute inset-0"
          style={{ originY: full ? 0.85 : 1 }}
          initial={false}
          animate={body.animate}
          transition={body.transition}
        >
          <svg
            viewBox={VIEWBOX[variant]}
            width={size}
            height={size}
            className="block overflow-visible"
          >
            <defs>
              <linearGradient id={ref("shell")} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--color-surface-hover)" />
                <stop offset="1" stopColor="var(--color-surface)" />
              </linearGradient>
              <linearGradient id={ref("glass")} x1="0" x2="0.4" y1="0" y2="1">
                <stop offset="0" stopColor="var(--color-canvas)" />
                <stop offset="1" stopColor="var(--color-canvas-deep)" />
              </linearGradient>
              <radialGradient id={ref("glow")}>
                <stop offset="0" stopColor="var(--color-teal)" stopOpacity="0.9" />
                <stop offset="0.45" stopColor="var(--color-teal)" stopOpacity="0.3" />
                <stop offset="1" stopColor="var(--color-teal)" stopOpacity="0" />
              </radialGradient>
              <radialGradient id={ref("haze")}>
                <stop offset="0" stopColor="var(--color-teal)" stopOpacity="0.35" />
                <stop offset="1" stopColor="var(--color-teal)" stopOpacity="0" />
              </radialGradient>
              <linearGradient id={ref("sweep")} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="var(--color-white)" stopOpacity="0" />
                <stop offset="0.5" stopColor="var(--color-white)" stopOpacity="0.28" />
                <stop offset="1" stopColor="var(--color-white)" stopOpacity="0" />
              </linearGradient>
              <clipPath id={ref("display")}>
                <rect x="32" y="30" width="56" height="38" rx="15" />
              </clipPath>
            </defs>

            {/* Short burst of light when happy */}
            <motion.circle
              cx="60"
              cy={full ? 62 : 42}
              r={full ? 58 : 46}
              fill={`url(#${ref("haze")})`}
              initial={false}
              animate={
                state !== "happy"
                  ? { opacity: 0 }
                  : live
                    ? { opacity: [0, 0.2, 1, 0.3, 0] }
                    : { opacity: 0.5 }
              }
              transition={state === "happy" && live ? HOP : fade}
            />

            {full && (
              <g>
                {/* Body capsule */}
                <rect
                  x="42"
                  y="73"
                  width="36"
                  height="30"
                  rx="15"
                  fill={`url(#${ref("shell")})`}
                  stroke="var(--color-teal)"
                  strokeWidth="2.5"
                />
                <path
                  d="M47 83 Q50 77.5 57 77"
                  fill="none"
                  stroke="var(--color-white)"
                  strokeOpacity="0.16"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="60" cy="90" r="7" fill={`url(#${ref("glow")})`} opacity="0.55" />
                <circle cx="60" cy="90" r="2.6" fill="var(--color-teal)" />
              </g>
            )}

            {/* Head, tilting from its chin */}
            <motion.g
              style={fillBox(0.5, 1)}
              initial={false}
              animate={{ rotate: pose.headTilt + tilt }}
              transition={soft}
            >
              {/* Antenna */}
              <motion.g
                initial={false}
                animate={{ y: state === "surprised" ? -4.5 : 0 }}
                transition={
                  reduce ? still : { type: "spring", stiffness: 700, damping: 11, mass: 0.6 }
                }
              >
                <line
                  x1="60"
                  y1="23"
                  x2="60"
                  y2="13.5"
                  stroke="var(--color-teal)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <motion.circle
                  cx="60"
                  cy="10"
                  r="9.5"
                  fill={`url(#${ref("glow")})`}
                  initial={false}
                  animate={antennaGlow.animate}
                  transition={antennaGlow.transition}
                />
                <motion.circle
                  cx="60"
                  cy="10"
                  r="4"
                  fill="var(--color-teal)"
                  initial={false}
                  animate={{ opacity: sleeping ? 0.55 : 1 }}
                  transition={fade}
                />
                <circle cx="58.7" cy="8.7" r="1.3" fill="var(--color-white)" opacity="0.85" />
              </motion.g>

              {/* Ears */}
              {[20, 93].map((x) => (
                <rect
                  key={x}
                  x={x}
                  y="40"
                  width="7"
                  height="17"
                  rx="3.5"
                  fill="var(--color-surface)"
                  stroke="var(--color-teal)"
                  strokeWidth="2"
                />
              ))}

              {/* Head shell */}
              <rect
                x="25"
                y="22"
                width="70"
                height="54"
                rx="22"
                fill={`url(#${ref("shell")})`}
                stroke="var(--color-teal)"
                strokeWidth="2.5"
              />
              <path
                d="M38 25.5 Q60 23 82 25.5"
                fill="none"
                stroke="var(--color-white)"
                strokeOpacity="0.14"
                strokeWidth="1.6"
                strokeLinecap="round"
              />

              {/* Display: dark glass */}
              <rect
                x="32"
                y="30"
                width="56"
                height="38"
                rx="15"
                fill={`url(#${ref("glass")})`}
                stroke="var(--color-teal)"
                strokeOpacity="0.35"
                strokeWidth="1"
              />
              <g clipPath={`url(#${ref("display")})`}>
                <ellipse cx="60" cy="49" rx="30" ry="18" fill={`url(#${ref("haze")})`} />

                {/* Eyes */}
                <motion.g style={{ x: lookX, y: lookY }}>
                  {EYES.map((cx) => (
                    <g key={cx}>
                      <motion.g
                        style={fillBox(0.5, 0.5)}
                        initial={false}
                        animate={{
                          scaleX: pose.eyes === "open" ? pose.eyeScaleX : 1,
                          scaleY: pose.eyes === "open" ? eyeScaleY : 0.3,
                          opacity: pose.eyes === "open" ? 1 : 0,
                        }}
                        transition={eyeTransition}
                      >
                        <ellipse
                          cx={cx}
                          cy={EYE_Y}
                          rx="10"
                          ry="11"
                          fill={`url(#${ref("glow")})`}
                          opacity="0.45"
                        />
                        <rect
                          x={cx - 5.5}
                          y={EYE_Y - 7.5}
                          width="11"
                          height="15"
                          rx="5.5"
                          fill="var(--color-teal)"
                        />
                        <circle cx={cx + 1.9} cy={EYE_Y - 3.4} r="1.9" fill="var(--color-white)" />
                        <circle
                          cx={cx - 1.6}
                          cy={EYE_Y + 3.2}
                          r="0.9"
                          fill="var(--color-white)"
                          opacity="0.6"
                        />
                      </motion.g>
                      <motion.g
                        style={fillBox(0.5, 1)}
                        initial={false}
                        animate={{
                          opacity: pose.eyes === "arc" ? 1 : 0,
                          scaleY: pose.eyes === "arc" ? 1 : 0.3,
                        }}
                        transition={spring}
                      >
                        <GlowStroke
                          d={`M${cx - 6} ${EYE_Y + 2.5} Q${cx} ${EYE_Y - 7} ${cx + 6} ${EYE_Y + 2.5}`}
                          width={3.2}
                        />
                      </motion.g>
                      <motion.g
                        initial={false}
                        animate={{ opacity: pose.eyes === "closed" ? 1 : 0 }}
                        transition={fade}
                      >
                        <GlowStroke
                          d={`M${cx - 6} ${EYE_Y} Q${cx} ${EYE_Y + 4.5} ${cx + 6} ${EYE_Y}`}
                          width={2.8}
                        />
                      </motion.g>
                    </g>
                  ))}
                </motion.g>

                {/* Mouth: a line of light */}
                <Mouth show={pose.mouth === "smile"} transition={spring}>
                  <GlowStroke d="M54 58.5 Q60 62.5 66 58.5" width={2.2} />
                </Mouth>
                <Mouth show={pose.mouth === "wide"} transition={spring}>
                  <GlowStroke d="M50.5 57 Q60 66.5 69.5 57" width={2.5} />
                </Mouth>
                <Mouth show={pose.mouth === "o"} transition={spring}>
                  <ellipse
                    cx="60"
                    cy="60"
                    rx="2.8"
                    ry="3.4"
                    fill="none"
                    stroke="var(--color-teal)"
                    strokeWidth="2.2"
                  />
                </Mouth>
                <Mouth show={pose.mouth === "flat"} transition={spring}>
                  <GlowStroke d="M56 60 L64 60" width={2.2} />
                </Mouth>

                {/* Light passing over the display while thinking */}
                {state === "thinking" && live && (
                  <motion.path
                    d="M10 26 h14 l-9 48 h-14 z"
                    fill={`url(#${ref("sweep")})`}
                    initial={{ x: 18, opacity: 0 }}
                    animate={{ x: [18, 90], opacity: [0, 1, 0] }}
                    transition={{
                      duration: 1.3,
                      repeat: Infinity,
                      repeatDelay: 0.35,
                      ease: "easeInOut",
                    }}
                  />
                )}

                {/* Glass reflection */}
                <path
                  d="M37 45 Q37 34 48 33 L55 33 Q42 36 40 47 Z"
                  fill="var(--color-white)"
                  opacity="0.1"
                />
              </g>
            </motion.g>

            {/* Arms in front of the head, pivoting at the shoulder, so a raised hand stays visible */}
            {full && (
              <g>
                <motion.g
                  style={fillBox(0.5, 0.1)}
                  initial={false}
                  animate={leftArm.animate}
                  transition={leftArm.transition}
                >
                  <Arm x={33} />
                </motion.g>
                <motion.g
                  style={fillBox(0.5, 0.1)}
                  initial={false}
                  animate={rightArm.animate}
                  transition={rightArm.transition}
                >
                  <Arm x={79} />
                </motion.g>
              </g>
            )}

            {/* Sleeping z's */}
            {sleeping &&
              [0, 1, 2].map((i) => (
                <g
                  key={i}
                  transform={`translate(${92 + i * 5} ${20 - i * 7}) scale(${0.8 + i * 0.2})`}
                >
                  <motion.path
                    d="M0 0 h5 l-5 6 h5"
                    fill="none"
                    stroke="var(--color-teal)"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={live ? { opacity: 0 } : false}
                    animate={live ? { y: [4, -6], opacity: [0, 1, 0] } : { opacity: 0.8 }}
                    transition={
                      live
                        ? { duration: 2.4, delay: i * 0.8, repeat: Infinity, ease: "easeOut" }
                        : still
                    }
                  />
                </g>
              ))}
          </svg>
        </motion.div>
      </motion.div>
    </motion.div>
  );
});

function Arm({ x }: { x: number }) {
  return (
    <>
      <rect
        x={x}
        y="79"
        width="8"
        height="20"
        rx="4"
        fill="var(--color-surface-hover)"
        stroke="var(--color-teal)"
        strokeWidth="2"
      />
      <circle cx={x + 4} cy="95" r="1.4" fill="var(--color-teal)" opacity="0.7" />
    </>
  );
}

/** A teal line with a soft halo, so it reads as light rather than ink. */
function GlowStroke({ d, width }: { d: string; width: number }) {
  return (
    <>
      <path
        d={d}
        fill="none"
        stroke="var(--color-teal)"
        strokeOpacity="0.25"
        strokeWidth={width * 2.4}
        strokeLinecap="round"
      />
      <path
        d={d}
        fill="none"
        stroke="var(--color-teal)"
        strokeWidth={width}
        strokeLinecap="round"
      />
    </>
  );
}

function Mouth({
  show,
  transition,
  children,
}: {
  show: boolean;
  transition: Transition;
  children: React.ReactNode;
}) {
  return (
    <motion.g
      style={fillBox(0.5, 0.5)}
      initial={false}
      animate={{ opacity: show ? 1 : 0, scale: show ? 1 : 0.6 }}
      transition={transition}
    >
      {children}
    </motion.g>
  );
}

function bodyMotion(
  state: JarvisState,
  live: boolean,
  amp: number,
  lean: number,
  spring: Transition,
): { animate: TargetAndTransition; transition: Transition } {
  const rest = { y: 0, scaleX: 1, scaleY: 1, rotate: lean };
  if (!live) return { animate: rest, transition: spring };
  switch (state) {
    case "happy":
      return {
        animate: {
          y: [0, amp * 0.35, -amp * 2.6, 0, 0],
          scaleX: [1, 1.12, 0.92, 1.06, 1],
          scaleY: [1, 0.86, 1.1, 0.94, 1],
          rotate: lean,
        },
        transition: { ...HOP, rotate: spring },
      };
    case "surprised":
      return {
        animate: {
          y: [0, -amp * 1.3, 0],
          scaleX: [1, 0.94, 1],
          scaleY: [1, 1.08, 1],
          rotate: lean,
        },
        transition: { duration: 0.45, ease: "easeOut", rotate: spring },
      };
    case "sleeping":
      return {
        animate: { y: 0, scaleX: [1, 0.985, 1], scaleY: [1, 1.035, 1], rotate: lean },
        transition: {
          duration: 4.2,
          ease: "easeInOut",
          repeat: Infinity,
          y: spring,
          rotate: spring,
        },
      };
    default:
      return { animate: rest, transition: spring };
  }
}

function armMotion(
  angle: number,
  loop: "wave" | "tap" | null,
  live: boolean,
  spring: Transition,
): { animate: TargetAndTransition; transition: Transition } {
  if (!live || !loop) return { animate: { rotate: angle }, transition: spring };
  if (loop === "wave") {
    return {
      animate: { rotate: [angle, angle + 26, angle - 8, angle + 22, angle] },
      transition: { duration: 1.1, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.25 },
    };
  }
  const nudge = angle < 0 ? -7 : 7;
  return {
    animate: { rotate: [angle, angle + nudge, angle] },
    transition: { duration: 1.2, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.4 },
  };
}

/** True for ~110 ms every 4–6 s; sometimes a double blink. */
function useBlink(enabled: boolean): boolean {
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const blink = (then: () => void) => {
      setBlinking(true);
      timer = setTimeout(() => {
        setBlinking(false);
        then();
      }, 110);
    };
    const schedule = () => {
      timer = setTimeout(() => {
        if (Math.random() < 0.2) blink(() => (timer = setTimeout(() => blink(schedule), 160)));
        else blink(schedule);
      }, nextBlinkDelay());
    };
    schedule();
    return () => {
      clearTimeout(timer);
      setBlinking(false);
    };
  }, [enabled]);

  return blinking;
}

/** Now and then a curious head tilt, held for a moment. */
function useIdleTilt(enabled: boolean): number {
  const [tilt, setTilt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setTilt(Math.random() < 0.5 ? -7 : 7);
        timer = setTimeout(() => {
          setTilt(0);
          schedule();
        }, 1600);
      }, nextTiltDelay());
    };
    schedule();
    return () => {
      clearTimeout(timer);
      setTilt(0);
    };
  }, [enabled]);

  return tilt;
}
