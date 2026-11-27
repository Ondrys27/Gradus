import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { AppearanceView } from "../custom-tokens";

/** The attributes and variables of a view on an element, so it paints itself in that theme. */
export function themedProps(view: AppearanceView): Record<string, unknown> & { style: CSSProperties } {
  return { "data-theme": view.theme, ...view.attrs, style: view.style as CSSProperties };
}

/**
 * A miniature of the app painted with a theme's own tokens, so a theme in a
 * list is seen as the interface it makes, not as a colour square: the top
 * bar with the search field and the avatar, the sidebar with the mark and
 * the lit menu item, a title, three stat tiles, a card with a progress bar
 * and the primary button. The backdrop's glow is a gradient, no blur, so a
 * grid of them stays cheap. Corners follow the theme's radius.
 */
export function ThemeMiniature({ view, dimmed = false, className }: { view: AppearanceView; dimmed?: boolean; className?: string }) {
  return (
    <span
      {...themedProps(view)}
      aria-hidden
      className={cn(
        "relative isolate flex aspect-[5/3] w-full flex-col overflow-hidden rounded-[calc(var(--radius-card)/2)] border border-line bg-canvas",
        dimmed && "opacity-45 grayscale-[40%]",
        className,
      )}
    >
      {/* Backdrop: the theme's glow(s) or gradient, as gradients. */}
      <span className="pointer-events-none absolute inset-0 -z-10 [display:var(--bg-gradient,none)] bg-linear-to-b from-canvas via-canvas to-[color-mix(in_oklab,var(--color-violet)_18%,var(--color-canvas-deep))]" />
      <span className="pointer-events-none absolute inset-0 -z-10 [display:var(--bg-glow-a,block)] bg-[radial-gradient(70%_70%_at_0%_100%,color-mix(in_oklab,var(--color-violet)_38%,transparent),transparent_70%)]" />
      <span className="pointer-events-none absolute inset-0 -z-10 [display:var(--bg-glow-b,block)] bg-[radial-gradient(60%_60%_at_100%_0%,color-mix(in_oklab,var(--color-teal)_30%,transparent),transparent_70%)]" />

      {/* Top bar */}
      <span className="flex h-[14%] items-center gap-1 border-b border-line/70 px-1.5">
        <span className="flex h-[55%] w-[22%] items-center gap-0.5 pl-0.5">
          <span className="block h-full w-[32%] rounded-[1px] bg-violet" />
          <span className="block h-[70%] w-[32%] rounded-[1px] bg-teal" />
        </span>
        <span className="mx-auto h-[55%] w-[34%] rounded-full border border-line bg-surface/70" />
        <span className="size-[9%] rounded-full bg-linear-to-br from-violet to-teal" />
      </span>

      <span className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <span className="flex w-[18%] flex-col gap-[6%] border-r border-line/70 bg-canvas-deep/60 p-[3%]">
          <span className="h-[7%] w-full rounded-[2px] bg-violet/25 ring-1 ring-violet/40" />
          <span className="h-[5%] w-[80%] rounded-full bg-ink-muted/45" />
          <span className="h-[5%] w-[70%] rounded-full bg-ink-muted/45" />
          <span className="h-[5%] w-[85%] rounded-full bg-ink-muted/45" />
          <span className="h-[5%] w-[60%] rounded-full bg-ink-muted/45" />
        </span>

        {/* Content */}
        <span className="flex min-w-0 flex-1 flex-col gap-[4%] p-[3.5%]">
          <span className="flex items-center justify-between">
            <span className="h-[6px] w-[38%] rounded-full bg-ink" />
            <span className="h-[7px] w-[16%] rounded-[calc(var(--radius)/3)] bg-violet" />
          </span>
          <span className="grid grid-cols-3 gap-[3%]">
            {(["bg-violet", "bg-teal", "bg-gold"] as const).map((tone) => (
              <span
                key={tone}
                className="flex flex-col justify-between rounded-[calc(var(--radius-card)/3.5)] border border-line bg-surface p-[6%] shadow-glow"
                style={{ aspectRatio: "7 / 4" }}
              >
                <span className={cn("size-[22%] self-end rounded-full opacity-90", tone)} />
                <span className="h-[14%] w-[55%] rounded-full bg-ink" />
              </span>
            ))}
          </span>
          <span className="flex flex-1 flex-col justify-between rounded-[calc(var(--radius-card)/3.5)] border border-line bg-surface p-[4%] shadow-glow">
            <span className="flex items-center justify-between">
              <span className="h-[4px] w-[45%] rounded-full bg-ink-soft" />
              <span className="h-[5px] w-[22%] rounded-full bg-gold/25 ring-1 ring-gold/50" />
            </span>
            <span className="h-[5px] w-full overflow-hidden rounded-full bg-line">
              <span className="block h-full w-[62%] rounded-full bg-linear-to-r from-violet to-teal" />
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}
