"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";

/** The website needs no data layer; only motion that respects the OS setting. */
export function MarketingProviders({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
