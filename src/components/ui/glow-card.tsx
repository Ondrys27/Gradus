import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type GlowCardProps = ComponentProps<"div"> & {
  /** Hover state: lighter border, stronger glow, 2 px lift. On by default. */
  interactive?: boolean;
};

export function GlowCard({ interactive = true, className, ...props }: GlowCardProps) {
  return (
    <div
      data-slot="glow-card"
      className={cn(
        "rounded-card border border-line bg-surface p-5 shadow-glow",
        interactive &&
          "transition-[translate,box-shadow,border-color,background-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-hover hover:shadow-glow-strong motion-reduce:hover:translate-y-0",
        className,
      )}
      {...props}
    />
  );
}
