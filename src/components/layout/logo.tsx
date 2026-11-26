"use client";

import { useId, type CSSProperties } from "react";
import { LOCKUP, MARK, WORDMARK } from "@/components/brand/logo-geometry";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

const FILL = { violet: "fill-logo-violet", teal: "fill-logo-teal" } as const;
const VIOLET: CSSProperties = { stopColor: "var(--color-logo-violet)" };
const TEAL: CSSProperties = { stopColor: "var(--color-logo-teal)" };

/**
 * The logo as vectors (scripts/brand-assets.mjs): three rising bars, and with
 * `withName` the name beside them in the brand font. Sized by height
 * (`h-*`); the width follows. The bars keep their colours in every theme, the
 * name takes the text colour (`text-ink` by default).
 */
export function Logo({ className, withName = false }: { className?: string; withName?: boolean }) {
  // Each logo has its own gradient: one defined in a hidden copy (the sidebar
  // on a phone) would leave the middle bar empty in the others.
  const gradient = `logo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const width = withName ? LOCKUP.width : MARK.width;
  return (
    <svg
      viewBox={`0 0 ${width} ${MARK.height}`}
      style={{ aspectRatio: `${width} / ${MARK.height}` }}
      className={cn("block h-7 w-auto shrink-0 text-ink", className)}
      {...(withName ? { role: "img", "aria-label": APP_NAME } : { "aria-hidden": true })}
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gradient}
          gradientUnits="userSpaceOnUse"
          x1={MARK.gradient.x1}
          y1={MARK.gradient.y1}
          x2={MARK.gradient.x2}
          y2={MARK.gradient.y2}
        >
          <stop offset="0" style={VIOLET} />
          <stop offset="1" style={TEAL} />
        </linearGradient>
      </defs>
      {MARK.bars.map((bar) => (
        <rect
          key={bar.y}
          x={bar.x}
          y={bar.y}
          width={MARK.bar.width}
          height={MARK.bar.height}
          rx={MARK.bar.radius}
          className={bar.fill === "gradient" ? undefined : FILL[bar.fill]}
          fill={bar.fill === "gradient" ? `url(#${gradient})` : undefined}
        />
      ))}
      {withName && <path d={WORDMARK.d} fill="currentColor" />}
    </svg>
  );
}
