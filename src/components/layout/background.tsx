import { cn } from "@/lib/utils";

/**
 * Fixed app backdrop: 100 px grid plus a violet (bottom-left) and teal
 * (top-right) glow. A custom theme (30.6) picks a plain canvas, a gradient or
 * one soft glow; which layers show is set by `--bg-*` from its data-backdrop.
 */
export function Background() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-canvas">
      <BackdropLayers />
    </div>
  );
}

const SIZES = {
  page: {
    grid: "bg-size-[100px_100px]",
    a: "-bottom-[30vw] -left-[20vw] w-[60vw] blur-[140px]",
    b: "-top-[22vw] -right-[15vw] w-[45vw] blur-[140px]",
  },
  // Inside a preview (the custom theme editor, a miniature): sized by the box, not the window.
  box: {
    grid: "bg-size-[40px_40px]",
    a: "-bottom-1/3 -left-1/4 w-3/4 blur-3xl",
    b: "-top-1/3 -right-1/5 w-3/5 blur-3xl",
  },
} as const;

/** The layers of the backdrop; `box` draws them inside a positioned preview. */
export function BackdropLayers({ size = "page" }: { size?: keyof typeof SIZES }) {
  const s = SIZES[size];
  return (
    <>
      <div className="absolute inset-0 [display:var(--bg-gradient,none)] bg-linear-to-b from-canvas via-canvas to-[color-mix(in_oklab,var(--color-violet)_18%,var(--color-canvas-deep))]" />
      <div
        className={cn(
          "absolute inset-0 [display:var(--bg-grid,block)] bg-[linear-gradient(to_right,var(--color-grid)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-grid)_1px,transparent_1px)]",
          s.grid,
        )}
      />
      <div className={cn("absolute aspect-square rounded-full bg-violet opacity-35 [display:var(--bg-glow-a,block)]", s.a)} />
      <div className={cn("absolute aspect-square rounded-full bg-teal opacity-30 [display:var(--bg-glow-b,block)]", s.b)} />
    </>
  );
}
