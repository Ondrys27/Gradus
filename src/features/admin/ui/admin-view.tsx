"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useTransition,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * A change of view within a page of the administration (period, comparison,
 * segment, internal accounts, tab, sort, page) keeps the scroll position and
 * the page on screen: the navigation runs as a transition without scrolling,
 * the page's Suspense boundaries keep their old content until the new numbers
 * are in, and meanwhile the content is dimmed. Going to another section from
 * the menu is an ordinary link and starts at the top.
 */

type AdminViewContextValue = {
  pending: boolean;
  /** Push for a new entry in the history (tabs, pages), replace for the shared controls. */
  navigate: (href: string, mode?: "push" | "replace") => void;
};

const AdminViewContext = createContext<AdminViewContextValue | null>(null);

export function AdminViewProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = useCallback(
    (href: string, mode: "push" | "replace" = "push") => {
      startTransition(() => {
        if (mode === "replace") router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
      });
    },
    [router],
  );
  const value = useMemo(() => ({ pending, navigate }), [pending, navigate]);
  return <AdminViewContext.Provider value={value}>{children}</AdminViewContext.Provider>;
}

export function useAdminView(): AdminViewContextValue {
  const context = useContext(AdminViewContext);
  if (!context) throw new Error("useAdminView outside AdminViewProvider");
  return context;
}

/** The page content, dimmed while a new view loads; the old layout stays put. */
export function AdminViewMain({ className, children }: { className?: string; children: ReactNode }) {
  const { pending } = useAdminView();
  return (
    <main
      aria-busy={pending || undefined}
      data-view-pending={pending || undefined}
      className={cn(
        "transition-opacity duration-200 motion-reduce:transition-none",
        pending && "opacity-60",
        className,
      )}
    >
      {children}
    </main>
  );
}

/** Whether a click on a link should be left to the browser (new tab, download…). */
export function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (event.currentTarget.target !== "" && event.currentTarget.target !== "_self")
  );
}

/**
 * A link that changes the view of the current page: no scroll to the top and
 * the content dimmed while it loads. Never prefetched (every view is audited).
 */
export function AdminViewLink({
  href,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, "href" | "prefetch" | "scroll"> & { href: string }) {
  const { navigate } = useAdminView();
  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      scroll={false}
      onClick={(event) => {
        onClick?.(event);
        if (isModifiedClick(event)) return;
        event.preventDefault();
        navigate(href, "push");
      }}
    />
  );
}
