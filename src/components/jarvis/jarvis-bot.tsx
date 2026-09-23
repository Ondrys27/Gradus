"use client";

import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import { cn } from "@/lib/utils";

export type JarvisState = "idle" | "thinking" | "happy";

type JarvisBotProps = {
  /** Rendered width and height in px. Drawn to stay legible down to 24 px. */
  size?: number;
  state?: JarvisState;
  className?: string;
};

const BLINK_EVERY_MS = 5000;

/**
 * Jarvis, drawn inline. Colours come from the design tokens only.
 * idle: blinks every ~5 s · thinking: squinting eyes with a light sweep · happy: wide smile and a hop.
 */
export function JarvisBot({ size = 40, state = "idle", className }: JarvisBotProps) {
  const id = useId().replace(/:/g, "");
  const reduceMotion = useReducedMotion();
  const blinking = useBlink(state === "idle" && !reduceMotion);

  const eyeScaleY = state === "thinking" ? 0.45 : blinking ? 0.1 : 1;
  const eyeTransition: Transition = reduceMotion
    ? { duration: 0 }
    : { duration: blinking ? 0.08 : 0.2, ease: "easeInOut" };

  const smile = state === "happy" ? "M23 41 Q32 50 41 41" : "M27 41.5 Q32 45.5 37 41.5";

  return (
    <motion.svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
      className={cn("shrink-0 overflow-visible", className)}
      animate={state === "happy" && !reduceMotion ? { y: [0, -6, 0, -3, 0] } : { y: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    >
      <defs>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id={`${id}-sweep`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--color-white)" stopOpacity="0" />
          <stop offset="0.5" stopColor="var(--color-white)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--color-white)" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-eyes`}>
          <ellipse cx="24" cy="31" rx="6.5" ry="2.9" />
          <ellipse cx="40" cy="31" rx="6.5" ry="2.9" />
        </clipPath>
      </defs>

      {/* Antenna */}
      <line
        x1="32"
        y1="14"
        x2="32"
        y2="7.5"
        stroke="var(--color-teal)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="6" r="3.4" fill="var(--color-teal)" filter={`url(#${id}-glow)`} />

      {/* Ears */}
      <rect
        x="6.5"
        y="26"
        width="6"
        height="12"
        rx="3"
        fill="var(--color-surface)"
        stroke="var(--color-teal)"
        strokeWidth="2.5"
      />
      <rect
        x="51.5"
        y="26"
        width="6"
        height="12"
        rx="3"
        fill="var(--color-surface)"
        stroke="var(--color-teal)"
        strokeWidth="2.5"
      />

      {/* Head */}
      <rect
        x="12"
        y="14"
        width="40"
        height="38"
        rx="12"
        fill="var(--color-surface)"
        stroke="var(--color-teal)"
        strokeWidth="2.5"
      />

      {/* Eyes */}
      {[24, 40].map((cx) => (
        <motion.g
          key={cx}
          style={{ transformBox: "fill-box", originX: 0.5, originY: 0.5 }}
          animate={{ scaleY: eyeScaleY }}
          transition={eyeTransition}
        >
          <circle cx={cx} cy="31" r="6.5" fill="var(--color-teal)" filter={`url(#${id}-glow)`} />
          <circle cx={cx + 2.2} cy="28.8" r="1.9" fill="var(--color-white)" />
        </motion.g>
      ))}

      {state === "thinking" && !reduceMotion && (
        <g clipPath={`url(#${id}-eyes)`}>
          <motion.rect
            y="26"
            width="10"
            height="10"
            fill={`url(#${id}-sweep)`}
            initial={{ x: 10 }}
            animate={{ x: [10, 50] }}
            transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.25 }}
          />
        </g>
      )}

      {/* Smile */}
      <motion.path
        d={smile}
        initial={false}
        animate={{ d: smile }}
        transition={
          reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 18 }
        }
        fill="none"
        stroke="var(--color-teal)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </motion.svg>
  );
}

/** True for ~140 ms roughly every five seconds, with a little jitter so it feels alive. */
function useBlink(enabled: boolean): boolean {
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          setBlinking(true);
          timer = setTimeout(() => {
            setBlinking(false);
            schedule();
          }, 140);
        },
        BLINK_EVERY_MS - 800 + Math.random() * 1600,
      );
    };
    schedule();
    return () => {
      clearTimeout(timer);
      setBlinking(false);
    };
  }, [enabled]);

  return blinking;
}
