"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import { BugIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { BELL_ICON } from "./appearance";
import { badgeText, ERROR_BADGE_POLL_MS, titleWithCount, type ErrorBadge } from "./error-badge";

/** Fired after a change of an error's state, so the badge asks again at once. */
export const ERROR_BADGE_EVENT = "gradus:admin-error-badge";

async function fetchBadge(): Promise<ErrorBadge> {
  const response = await fetch("/api/admin/errors/badge", { cache: "no-store" });
  if (!response.ok) throw new Error(`error badge: ${response.status}`);
  return (await response.json()) as ErrorBadge;
}

/**
 * New errors, shared by the menu's badge, the tab's title and the bell: one
 * request a minute while the tab is visible (none while it is hidden), and
 * at once after a state was changed anywhere on the page.
 */
export function useErrorBadge() {
  const query = useQuery({
    queryKey: ["admin-error-badge"],
    queryFn: fetchBadge,
    refetchInterval: ERROR_BADGE_POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: ERROR_BADGE_POLL_MS / 2,
    retry: false,
  });
  const { refetch } = query;
  useEffect(() => {
    const again = () => void refetch();
    window.addEventListener(ERROR_BADGE_EVENT, again);
    return () => window.removeEventListener(ERROR_BADGE_EVENT, again);
  }, [refetch]);
  return query.data;
}

/** The red count next to Operations → Errors; nothing without new errors. */
export function ErrorCountBadge({ className }: { className?: string }) {
  const t = useTranslations("admin.widgets.badge");
  const badge = useErrorBadge();
  const count = badge?.count ?? 0;
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "grid h-5 min-w-5 place-items-center rounded-full bg-pink px-1 text-[11px] font-bold text-canvas tabular-nums",
        className,
      )}
      data-testid="admin-error-badge"
      aria-label={t("label", { count })}
    >
      {badgeText(count)}
    </span>
  );
}

/** "(3) …" in front of the tab's title while there are new errors; Next.js sets the title anew on every page. */
export function ErrorTitleCount() {
  const badge = useErrorBadge();
  const pathname = usePathname();
  const count = badge?.count ?? 0;
  useEffect(() => {
    const apply = () => {
      const next = titleWithCount(document.title, count);
      if (next !== document.title) document.title = next;
    };
    apply();
    const title = document.querySelector("title");
    if (!title || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(apply);
    observer.observe(title, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      document.title = titleWithCount(document.title, 0);
    };
  }, [count, pathname]);
  return null;
}

const itemClass =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-sm text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink";

/** The bell of the administration: the newest new errors, each opens in the log. */
export function AdminBell({ className }: { className?: string }) {
  const t = useTranslations("admin.widgets.badge");
  const badge = useErrorBadge();
  const count = badge?.count ?? 0;
  const latest = badge?.latest ?? [];
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={count ? t("bellCount", { count }) : t("bell")}
        data-testid="admin-bell"
        className={cn(
          "relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-9",
          className,
        )}
      >
        <BELL_ICON aria-hidden className="size-4" />
        {count > 0 && (
          <span
            aria-hidden
            data-testid="admin-bell-count"
            className="absolute -top-0.5 -right-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-pink px-1 text-[10px] font-bold text-canvas tabular-nums"
          >
            {badgeText(count)}
          </span>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-popover">
          <Menu.Popup className="max-h-[min(70vh,28rem)] w-[min(calc(100vw-24px),22rem)] overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
            <p className="micro-label px-3 py-1.5">
              {count
                ? t("title", { count, shown: formatNumber(count, {}, ADMIN_FORMAT_SETTINGS) })
                : t("empty")}
            </p>
            {latest.map((error) => (
              <Menu.LinkItem
                key={error.fingerprint}
                closeOnClick
                className={itemClass}
                render={<Link href={`/admin/chyby?group=${error.fingerprint}`} prefetch={false} />}
                data-testid="admin-bell-error"
              >
                <BugIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-pink" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-ink">{error.message}</span>
                  <span className="truncate text-xs text-ink-muted">
                    {error.code} · {error.page} ·{" "}
                    {formatDateTime(new Date(error.lastAt), ADMIN_FORMAT_SETTINGS)}
                  </span>
                </span>
              </Menu.LinkItem>
            ))}
            <Menu.LinkItem
              closeOnClick
              className={cn(itemClass, "items-center font-medium text-violet")}
              render={<Link href="/admin/chyby?status=new" prefetch={false} />}
            >
              {t("all")}
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
