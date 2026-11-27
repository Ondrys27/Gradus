import type { ReactNode } from "react";
import type { GuideSection } from "@/features/tutorial/ui-map/types";
import { QuickLookLink } from "@/features/tutorial/guide/quick-look-link";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** The one main action; a second, quieter one goes to `secondary`. */
  action?: ReactNode;
  secondary?: ReactNode;
  /** The section whose quick look (30.8) the empty state links to. */
  guide?: GuideSection;
  className?: string;
};

/**
 * Nothing here yet: one sentence on what the section is for, one action and,
 * for a section with a guide, "Quick look · 1–2 min" (30.9).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
  guide,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-1 grid size-14 place-items-center rounded-2xl border border-violet/30 bg-violet/12 text-violet shadow-glow [&_svg]:size-6">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="max-w-sm text-sm text-pretty text-ink-muted">{description}</p>}
      {(action || secondary) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondary}
        </div>
      )}
      {guide && <QuickLookLink section={guide} />}
    </div>
  );
}
