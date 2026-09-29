"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useIsFirstPaint } from "@/lib/first-paint";

/**
 * Fade and a 12 px rise over 250 ms. Never waits for data. The page the app
 * starts on is painted straight away; only later page changes animate.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const firstPaint = useIsFirstPaint();
  return (
    <motion.div
      initial={reduceMotion || firstPaint ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
