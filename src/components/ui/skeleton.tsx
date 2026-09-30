import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const base = "animate-skeleton rounded-lg bg-line/50";

type SkeletonProps =
  ({ inline?: false } & ComponentProps<"div">) | ({ inline: true } & ComponentProps<"span">);

/**
 * Placeholder while data loads. It is a block `<div>` by default; inside text
 * (`<p>`, `<span>`, `<label>`, `<button>`) use `inline`, which renders an
 * inline-block `<span>` so the HTML stays valid and hydration does not break.
 */
export function Skeleton({ inline, className, ...rest }: SkeletonProps) {
  if (inline) {
    return (
      <span
        aria-hidden
        data-slot="skeleton"
        className={cn(base, "inline-block align-middle", className)}
        {...(rest as ComponentProps<"span">)}
      />
    );
  }
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn(base, className)}
      {...(rest as ComponentProps<"div">)}
    />
  );
}
