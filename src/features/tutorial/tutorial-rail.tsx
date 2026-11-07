"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import type { PlannedStep } from "./engine";
import { chapterRail } from "./presentation";

/**
 * The tutorial's progress as a thin line along the top of the screen, one
 * segment per chapter, with the chapters' names underneath when asked for
 * (a look step on a larger screen: the page is dimmed, so they cover
 * nothing; a hands-on step and a phone keep just the line, the bubble names
 * the chapter). Never "step 7 of 31".
 */
export function TutorialRail({
  steps,
  index,
  names = false,
  className,
}: {
  steps: readonly PlannedStep[];
  index: number;
  names?: boolean;
  className?: string;
}) {
  const t = useTranslations("tutorial");
  const reduce = useReducedMotionSafe();
  const segments = chapterRail(steps, index);
  const current = segments.findIndex((segment) => segment.state === "current");
  const currentName = current >= 0 ? t(`chapters.${segments[current]!.chapter}`) : "";
  const label = t("rail.chapter", {
    current: Math.max(current, 0) + 1,
    total: segments.length,
    name: currentName,
  });
  return (
    <div
      role="progressbar"
      aria-label={t("rail.label")}
      aria-valuemin={1}
      aria-valuemax={segments.length}
      aria-valuenow={Math.max(current, 0) + 1}
      aria-valuetext={label}
      data-tutorial-rail=""
      className={cn("pointer-events-none fixed inset-x-0 top-0", className)}
    >
      <div className="flex h-[3px] gap-px bg-black/40">
        {segments.map((segment) => (
          <div
            key={segment.chapter}
            className="relative h-full overflow-hidden bg-white/10"
            style={{ flexBasis: `${segment.share * 100}%` }}
          >
            <motion.div
              className={cn(
                "absolute inset-y-0 left-0 origin-left",
                segment.state === "current"
                  ? "bg-teal shadow-[0_0_8px] shadow-teal/70"
                  : "bg-teal/80",
              )}
              initial={false}
              animate={{ scaleX: segment.fill }}
              style={{ width: "100%" }}
              transition={
                reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 22 }
              }
            />
          </div>
        ))}
      </div>
      {names && (
        <div className="hidden justify-center px-2 pt-1.5 md:flex">
          <ol
            aria-hidden
            className="flex max-w-full items-center gap-0.5 overflow-hidden rounded-full border border-line/70 bg-surface/85 px-1.5 py-0.5 text-[11px] leading-none font-medium shadow-popover backdrop-blur-md"
          >
            {segments.map((segment, position) => {
              const name = t(`chapters.${segment.chapter}`);
              return (
                <li key={segment.chapter} className="flex items-center gap-0.5 whitespace-nowrap">
                  {position > 0 && <span className="px-1 text-ink-muted/50">·</span>}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-1 transition-colors",
                      segment.state === "current" && "bg-teal/15 text-teal",
                      segment.state === "done" && "text-ink-soft",
                      segment.state === "ahead" && "text-ink-muted/70",
                    )}
                  >
                    {name}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
