"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ActivityIcon,
  BotIcon,
  CoinsIcon,
  CompassIcon,
  GamepadIcon,
  HeartPulseIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
  RepeatIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TrendingUpIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isActiveSection, sectionsFor, type AdminSectionKey } from "../nav";
import { parseAdminView, viewQuery } from "../view-state";
import type { AdminRole } from "../roles";

const ICONS: Record<AdminSectionKey, LucideIcon> = {
  overview: LayoutDashboardIcon,
  growth: TrendingUpIcon,
  activation: SparklesIcon,
  retention: RepeatIcon,
  features: ActivityIcon,
  ai: BotIcon,
  game: GamepadIcon,
  costs: CoinsIcon,
  health: HeartPulseIcon,
  feedback: MessageSquareIcon,
  users: UsersIcon,
  explorer: CompassIcon,
  audit: ScrollTextIcon,
  admins: ShieldCheckIcon,
};

const itemClass =
  "flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9";

/**
 * The sections of the administration: a sidebar on wide screens, a row that
 * scrolls sideways on narrow ones. Links keep the shared filters (period,
 * plan, country…) so switching pages keeps the view.
 */
export function AdminNav({ variant, role }: { variant: "sidebar" | "strip"; role: AdminRole }) {
  const t = useTranslations("admin.shell");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Only the shared view travels: a tab, sort or search belongs to its own page.
  const query = viewQuery(parseAdminView(new URLSearchParams(searchParams)));

  return (
    <nav aria-label={t("title")}>
      <ul
        className={cn(
          variant === "sidebar"
            ? "flex flex-col gap-0.5"
            : "-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]",
        )}
      >
        {sectionsFor(role).map((section) => {
          const Icon = ICONS[section.key];
          const label = t(`nav.${section.key}`);
          if (!section.ready) {
            return (
              <li key={section.key}>
                <span
                  aria-disabled
                  className={cn(itemClass, "cursor-default text-ink-muted/60")}
                  title={t("soon")}
                >
                  <Icon aria-hidden className="size-4" />
                  <span>{label}</span>
                  <span className="ml-auto rounded-full border border-line px-1.5 text-[10px] tracking-wide uppercase">
                    {t("soon")}
                  </span>
                </span>
              </li>
            );
          }
          const active = isActiveSection(section.href, pathname);
          // Every section keeps the view, also those without filters, so it survives the way back.
          const href = `${section.href}${query}`;
          return (
            <li key={section.key}>
              {/* No prefetch: every view is written to the audit, and only real visits count. */}
              <Link
                href={href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  itemClass,
                  active
                    ? "bg-violet/15 text-ink"
                    : "text-ink-soft hover:bg-surface-hover hover:text-ink",
                )}
              >
                <Icon aria-hidden className={cn("size-4", active && "text-violet")} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
