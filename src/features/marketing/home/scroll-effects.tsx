"use client";

import { useRef, type ReactNode } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { useMediaQuery } from "@/lib/use-media-query";

/** Read after hydration (false on the server), so the first render always matches. */
export function useReducedMotionSafe(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** Scroll distance (px) over which the hero preview straightens up. */
const HERO_STRAIGHTEN_PX = 420;

/**
 * The hero preview leans back in perspective and straightens as the page
 * scrolls. The starting tilt is server-rendered, so it shows before JavaScript.
 */
export function HeroTilt({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotionSafe();
  const { scrollY } = useScroll();
  const rotateX = useTransform(scrollY, [0, HERO_STRAIGHTEN_PX], [14, 0], { clamp: true });
  const scale = useTransform(scrollY, [0, HERO_STRAIGHTEN_PX], [0.93, 1], { clamp: true });
  const y = useTransform(scrollY, [0, HERO_STRAIGHTEN_PX], [0, -24], { clamp: true });

  return (
    <div className={className} style={{ perspective: 1400 }}>
      <motion.div
        style={reduce ? undefined : { rotateX, scale, y, transformOrigin: "50% 0%" }}
        className="will-change-transform"
      >
        {children}
      </motion.div>
    </div>
  );
}

/**
 * A feature screenshot drifts slightly against the scroll and comes into
 * focus as it reaches the middle of the screen: a blur layer above it fades
 * out (only its opacity animates, never the blur itself).
 */
export function DriftIntoFocus({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [48, -48]);
  const haze = useTransform(scrollYProgress, [0.08, 0.38], [1, 0], { clamp: true });

  return (
    <div ref={ref} className={className}>
      <motion.div style={reduce ? undefined : { y }} className="relative">
        {children}
        {!reduce && (
          <motion.div
            aria-hidden
            style={{ opacity: haze }}
            className="pointer-events-none absolute inset-0 rounded-2xl bg-canvas/30 backdrop-blur-md"
          />
        )}
      </motion.div>
    </div>
  );
}
