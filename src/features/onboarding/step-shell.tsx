import type { ReactNode } from "react";
import { Jarvis, type JarvisState } from "@/components/jarvis/jarvis";
import { cn } from "@/lib/utils";

/**
 * The layout every onboarding step shares: Jarvis, a title, an optional
 * description, the step's own content, then its own footer of buttons (so a
 * step that is saving something can disable just its own "continue").
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
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-col items-center gap-3 text-center">
        <Jarvis variant="head" size={64} state={jarvisState} />
        <h2 className="text-2xl font-bold text-balance text-ink">{title}</h2>
        {description && <p className="max-w-sm text-sm text-pretty text-ink-soft">{description}</p>}
      </div>
      {children && <div className="flex flex-col gap-4">{children}</div>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">{footer}</div>
    </div>
  );
}
