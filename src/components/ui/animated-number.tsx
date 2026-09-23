"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { formatNumber, type NumberFormat } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";

type AnimatedNumberProps = {
  value: number;
  format?: NumberFormat;
  /** Seconds. */
  duration?: number;
  className?: string;
};

/** Counts up from zero on mount, then animates between values. */
export function AnimatedNumber({ value, format, duration = 1.2, className }: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion();
  const settings = useFormatSettings();
  const [display, setDisplay] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    if (reduceMotion) {
      current.current = value;
      setDisplay(value);
      return;
    }
    const controls = animate(current.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        current.current = latest;
        setDisplay(latest);
      },
    });
    return () => controls.stop();
  }, [value, duration, reduceMotion]);

  return (
    <span className={cn("tabular-nums", className)}>
      <span aria-hidden>{formatNumber(display, format, settings)}</span>
      <span className="sr-only">{formatNumber(value, format, settings)}</span>
    </span>
  );
}
