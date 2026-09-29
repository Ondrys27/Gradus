"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { useIsFirstPaint } from "@/lib/first-paint";

const STAGGER_SECONDS = 0.04;

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
};

/**
 * Children marked with `StaggerItem` enter one after another, 40 ms apart.
 * Not on the server-rendered first paint, which must be visible without JavaScript.
 */
export function Stagger({ className, children }: { className?: string; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const firstPaint = useIsFirstPaint();
  return (
    <motion.div
      className={className}
      initial={reduceMotion || firstPaint ? false : "hidden"}
      animate="shown"
      variants={{ shown: { transition: { staggerChildren: STAGGER_SECONDS } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}
