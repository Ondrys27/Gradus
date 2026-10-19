import type { ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminViewLink } from "./admin-view";

export type ServerColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Sorting is the server's: the link that sorts by this column. */
  sortHref?: string;
  sorted?: "asc" | "desc" | null;
};

/**
 * A table the server renders row by row (users, audit): the same look as
 * the client `DataTable`, with sorting as links and paging as links under
 * it. Numbers on the right, a highlighted row under the pointer.
 */
export function ServerTable({
  columns,
  rows,
  minWidth = "48rem",
  caption,
}: {
  columns: ServerColumn[];
  rows: { key: string; cells: ReactNode[] }[];
  minWidth?: string;
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="text-xs text-ink-muted">
          <tr className="border-b border-line">
            {columns.map((column) => {
              const right = column.align === "right";
              const Icon = column.sorted === "asc" ? ArrowUpIcon : ArrowDownIcon;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.sorted ? (column.sorted === "asc" ? "ascending" : "descending") : undefined
                  }
                  className={cn("px-4 py-2 font-medium whitespace-nowrap", right && "text-right")}
                >
                  {column.sortHref ? (
                    <AdminViewLink
                      href={column.sortHref}
                      className={cn(
                        "inline-flex h-9 items-center gap-1 rounded-md outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50",
                        right && "flex-row-reverse",
                        column.sorted && "text-ink",
                      )}
                    >
                      {column.label}
                      {column.sorted && <Icon aria-hidden className="size-3" />}
                    </AdminViewLink>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-hover/60 motion-reduce:transition-none"
            >
              {row.cells.map((cell, index) => (
                <td
                  key={columns[index]?.key ?? index}
                  className={cn(
                    "px-4 py-2.5 whitespace-nowrap",
                    columns[index]?.align === "right" ? "text-right tabular-nums" : "text-ink-soft",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Newer / page n / older, under a server-paged table. */
export function ServerPager({
  page,
  hasMore,
  hrefFor,
  labels,
}: {
  page: number;
  hasMore: boolean;
  hrefFor: (page: number) => string;
  labels: { pagination: string; newer: string; older: string; page: string };
}) {
  if (page === 0 && !hasMore) return null;
  const link =
    "flex h-11 items-center rounded-lg px-3 text-sm font-medium text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:h-8";
  return (
    <nav aria-label={labels.pagination} className="flex items-center justify-between gap-2">
      {page > 0 ? (
        <AdminViewLink href={hrefFor(page - 1)} className={link}>
          {labels.newer}
        </AdminViewLink>
      ) : (
        <span />
      )}
      <span className="text-xs text-ink-muted tabular-nums">{labels.page}</span>
      {hasMore ? (
        <AdminViewLink href={hrefFor(page + 1)} className={link}>
          {labels.older}
        </AdminViewLink>
      ) : (
        <span />
      )}
    </nav>
  );
}
