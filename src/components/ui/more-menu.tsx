"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { EllipsisIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type MoreMenuProps = {
  /** The name of the button for screen readers and the tooltip ("More options"). */
  label: string;
  /** The `data-tutorial` key of the button itself (ui-map). */
  "data-tutorial"?: string;
  className?: string;
  children: ReactNode;
};

const itemClass =
  "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink data-disabled:cursor-default data-disabled:opacity-50 mouse:min-h-9 [&_svg]:size-4";

/**
 * The "⋯" beside a page's one main action (30.9): everything else the page
 * can do, in one menu at the same place on every screen. Its items are
 * `MoreMenuItem`s, each with its own `data-tutorial` so a guide can point at it.
 */
export function MoreMenu({ label, "data-tutorial": tutorial, className, children }: MoreMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        title={label}
        data-tutorial={tutorial}
        className={cn(
          "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-surface-hover aria-expanded:text-ink mouse:size-10",
          className,
        )}
      >
        <EllipsisIcon aria-hidden className="size-5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-popover">
          <Menu.Popup className="min-w-56 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

type MoreMenuItemProps = {
  label: string;
  icon?: ReactNode;
  /** A page to open; otherwise `onSelect` runs. */
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  "data-tutorial"?: string;
};

export function MoreMenuItem({ label, icon, href, onSelect, disabled, "data-tutorial": tutorial }: MoreMenuItemProps) {
  if (href && !disabled) {
    return (
      <Menu.Item data-tutorial={tutorial} className={itemClass} render={<Link href={href} />}>
        {icon}
        {label}
      </Menu.Item>
    );
  }
  return (
    <Menu.Item data-tutorial={tutorial} disabled={disabled} onClick={onSelect} className={itemClass}>
      {icon}
      {label}
    </Menu.Item>
  );
}
