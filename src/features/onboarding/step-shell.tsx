import { useRef, type ReactNode } from "react";
import { Jarvis, type JarvisState } from "@/components/jarvis/jarvis";
import { useOverflowBottom } from "@/lib/use-overflow-bottom";
import { cn } from "@/lib/utils";

/**
 * The layout every onboarding step shares: Jarvis, a title and an optional
 * description stay put at the top, the step's own footer of buttons stays
 * put at the bottom (so a step that is saving something can disable just
 * its own "continue"), and only the content between them — a long list of
 * paths or industries, say — scrolls on its own. A soft fade at its bottom
 * hints there is more below; `overscroll-behavior: contain` stops a drag
 * that reaches the end of that list from scrolling the page underneath.
 */
export function StepShell({
  jarvisState = "idle",
  title,
  description,
  children,
  footer,
  className,
}: {
  jarvisState?: JarvisState;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const moreBelow = useOverflowBottom(scrollRef);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex shrink-0 flex-col items-center gap-3 pb-4 text-center">
        <Jarvis variant="head" size={64} state={jarvisState} />
        <h2 className="text-2xl font-bold text-balance text-ink">{title}</h2>
        {description && <p className="max-w-sm text-sm text-pretty text-ink-soft">{description}</p>}
      </div>
      {/* Always reserved, even with no content, so the footer still pins to the bottom. */}
      <div className="relative min-h-0 flex-1">
        {children && (
          <>
            <div
              ref={scrollRef}
              className="flex h-full flex-col gap-4 overflow-y-auto overscroll-contain pb-1"
            >
              {children}
            </div>
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-canvas to-transparent transition-opacity",
                moreBelow ? "opacity-100" : "opacity-0",
              )}
            />
          </>
        )}
      </div>
      <div className="flex shrink-0 flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-center">
        {footer}
      </div>
    </div>
  );
}
