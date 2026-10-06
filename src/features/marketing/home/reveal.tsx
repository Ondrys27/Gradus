"use client";

import type { ReactNode } from "react";
import { motion, type Variants } from "framer-motion";

const EASE = [0.16, 1, 0.3, 1] as const;
/** Starts a little before the element is fully in view, and only once. */
const VIEWPORT = { once: true, margin: "0px 0px -12% 0px" } as const;

const rise: Variants = {
  hidden: { opacity: 0, y: 28 },
  // A delay set here would override a parent's stagger, so only when asked for.
  shown: (delay?: number) => ({
    opacity: 1,
    y: 0,
    transition: delay ? { duration: 0.7, ease: EASE, delay } : { duration: 0.7, ease: EASE },
  }),
};

/**
 * Rises and fades in once when it scrolls into view. Transform and opacity
 * only; with reduced motion MotionConfig skips the movement. `data-reveal`
 * lets the <noscript> style show it without JavaScript.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "li" | "header";
}) {
  const Component = motion[as];
  return (
    <Component
      data-reveal
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={VIEWPORT}
      variants={rise}
      custom={delay}
    >
      {children}
    </Component>
  );
}

/** A list whose `RevealItem` children enter one after another. */
export function RevealGroup({
  children,
  className,
  stagger = 0.1,
  as = "ul",
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  as?: "ul" | "ol" | "div";
}) {
  const Component = motion[as];
  return (
    <Component
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={VIEWPORT}
      variants={{ shown: { transition: { staggerChildren: stagger } } }}
    >
      {children}
    </Component>
  );
}

export function RevealItem({
  children,
  className,
  as = "li",
}: {
  children: ReactNode;
  className?: string;
  as?: "li" | "div";
}) {
  const Component = motion[as];
  return (
    <Component data-reveal className={className} variants={rise}>
      {children}
    </Component>
  );
}
