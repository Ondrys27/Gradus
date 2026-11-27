import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { AppearanceView } from "../custom-tokens";

/** The attributes and variables of a view on an element, so it paints itself in that theme. */
export function themedProps(view: AppearanceView): Record<string, unknown> & { style: CSSProperties } {
  return { "data-theme": view.theme, ...view.attrs, style: view.style as CSSProperties };
}

/** A miniature of the app painted with a theme's own tokens: sidebar, a card, a progress bar, a button. */
export function ThemeMiniature({ view, dimmed = false, className }: { view: AppearanceView; dimmed?: boolean; className?: string }) {
  return (
    <span
      {...themedProps(view)}
      aria-hidden
      className={cn(
        "relative flex aspect-[5/3] w-full overflow-hidden rounded-lg border border-line bg-canvas",
        dimmed && "opacity-45 grayscale-[40%]",
        className,
      )}
    >
      <span className="absolute -bottom-6 -left-6 size-14 rounded-full bg-violet opacity-40 blur-xl [display:var(--bg-glow-a,block)]" />
      <span className="absolute -top-6 -right-6 size-12 rounded-full bg-teal opacity-35 blur-xl [display:var(--bg-glow-b,block)]" />
      <span className="relative flex w-1/5 flex-col gap-1 border-r border-line bg-canvas-deep/70 p-1">
        <span className="size-2.5 rounded-[3px] bg-linear-to-br from-violet to-teal" />
        <span className="h-1 w-full rounded-full bg-violet/70" />
        <span className="h-1 w-3/4 rounded-full bg-ink-muted/50" />
        <span className="h-1 w-3/4 rounded-full bg-ink-muted/50" />
      </span>
      <span className="relative flex flex-1 flex-col gap-1 p-1.5">
        <span className="h-1.5 w-1/2 rounded-full bg-ink" />
        <span className="flex flex-1 gap-1">
          <span className="flex flex-1 flex-col gap-1 rounded-[calc(var(--radius-card)/3)] border border-line bg-surface p-1 shadow-glow">
            <span className="h-1 w-3/4 rounded-full bg-ink-soft/80" />
            <span className="mt-auto h-1 w-full overflow-hidden rounded-full bg-line">
              <span className="block h-full w-2/3 rounded-full bg-linear-to-r from-violet to-teal" />
            </span>
          </span>
          <span className="flex w-1/3 flex-col gap-1 rounded-[calc(var(--radius-card)/3)] border border-line bg-surface p-1">
            <span className="h-1 w-full rounded-full bg-green/80" />
            <span className="h-1 w-2/3 rounded-full bg-orange/80" />
            <span className="h-1 w-1/2 rounded-full bg-pink/80" />
          </span>
        </span>
        <span className="h-2 w-1/3 self-end rounded-[calc(var(--radius)/2)] bg-violet" />
      </span>
    </span>
  );
}
