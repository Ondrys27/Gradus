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

/** The bars alone and the whole lockup, as multiples of the logo's height. */
const MARK_RATIO = MARK.width / MARK.height;
const LOCKUP_RATIO = LOCKUP.width / MARK.height;
/** How far the name travels left to vanish behind the bars (lockup units, = user units). */
const NAME_SLIDE = LOCKUP.width - MARK.width;

/**
 * The logo of a sidebar that folds (30.1): the name slides into the bars as
 * the sidebar collapses and back out of them as it opens, in the sidebar's
 * own 200 ms ease-out, without moving the bars a pixel. The width of the box
 * follows, so nothing next to it jumps. `name`: "on" shown, "off" folded,
 * "wide" shown from 1024 px only (the app's rail below that). `animate`
 * false while the state is still being read (no slide on the first paint);
 * reduced motion never slides.
 */
export function FoldingLogo({
  name,
  height,
  animate = true,
  className,
}: {
  name: "on" | "off" | "wide";
  /** A CSS length, e.g. "1.875rem". */
  height: string;
  animate?: boolean;
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradient = `logo-${id}`;
  const clip = `logo-clip-${id}`;
  const style = {
    "--logo-h": height,
    "--logo-mark-w": `calc(${height} * ${MARK_RATIO})`,
    "--logo-full-w": `calc(${height} * ${LOCKUP_RATIO})`,
    "--logo-slide": `${NAME_SLIDE}px`,
  } as CSSProperties;
  return (
    <span
      data-name={name}
      data-animate={animate ? undefined : "false"}
      data-testid="folding-logo"
      style={style}
      className={cn(
        "group/logo relative block h-(--logo-h) w-(--logo-mark-w) shrink-0 overflow-hidden text-ink",
        "data-[name=on]:w-(--logo-full-w) lg:data-[name=wide]:w-(--logo-full-w)",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none data-[animate=false]:transition-none",
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${LOCKUP.width} ${MARK.height}`}
        className="absolute inset-y-0 left-0 block h-full w-auto"
        style={{ aspectRatio: `${LOCKUP.width} / ${MARK.height}` }}
        role="img"
        aria-label={APP_NAME}
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
          {/* Right of the bars only: the sliding name disappears into them. */}
          <clipPath id={clip}>
            <rect x={MARK.width} y={0} width={LOCKUP.width - MARK.width} height={MARK.height} />
          </clipPath>
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
        <g clipPath={`url(#${clip})`}>
          <path
            d={WORDMARK.d}
            fill="currentColor"
            className={cn(
              "-translate-x-(--logo-slide) opacity-0",
              "group-data-[name=on]/logo:translate-x-0 group-data-[name=on]/logo:opacity-100",
              "lg:group-data-[name=wide]/logo:translate-x-0 lg:group-data-[name=wide]/logo:opacity-100",
              "transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-none",
              "group-data-[animate=false]/logo:transition-none",
            )}
          />
        </g>
      </svg>
    </span>
  );
}
