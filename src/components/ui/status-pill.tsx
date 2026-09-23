import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { toneFill, toneSoft, type Tone } from "./tone";

type StatusPillProps = ComponentProps<"span"> & {
  tone?: Tone;
  /** Leading dot, useful for live or state indicators. */
  dot?: boolean;
};

export function StatusPill({
  tone = "neutral",
  dot,
  className,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap [&_svg]:size-3.5",
        toneSoft[tone],
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden className={cn("size-1.5 rounded-full", toneFill[tone])} />}
      {children}
    </span>
  );
}
