import type { ReactNode } from "react";

/**
 * The one bar every page starts with: the name of the page, one sentence of
 * what it shows, and on the right what changes the numbers (period,
 * comparison, filters). It sticks to the top while the page scrolls, so the
 * controls and the name are always in the same place. Plain markup, so both
 * server pages and the client controls can render it.
 */
export function AdminPageBar({
  title,
  description,
  controls,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** The right side of the bar: the shared controls or the page's own. */
  controls?: ReactNode;
  /** Under the bar, still sticky: active filter labels, a warning, a search field. */
  children?: ReactNode;
}) {
  return (
    <div
      className="sticky top-0 z-30 -mx-4 mb-5 flex flex-col gap-2 border-b border-line bg-canvas/90 px-4 py-2.5 backdrop-blur lg:-mx-6 lg:px-6"
      data-testid="admin-page-bar"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-xl leading-7 font-semibold tracking-tight text-ink">{title}</h1>
          {description && (
            <p className="hidden truncate text-xs leading-4 text-ink-muted md:block">{description}</p>
          )}
        </div>
        {controls && <div className="ml-auto flex max-w-full min-w-0">{controls}</div>}
      </div>
      {children}
    </div>
  );
}
