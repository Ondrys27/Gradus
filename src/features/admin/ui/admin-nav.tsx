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
  SparklesIcon,
  TrendingUpIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ADMIN_SECTIONS, isActiveSection, usesControls, type AdminSectionKey } from "../nav";

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
};

const itemClass =
  "flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9";

/**
 * The sections of the administration: a sidebar on wide screens, a row that
 * scrolls sideways on narrow ones. Links keep the shared controls (period,
 * segment…) so switching pages keeps the view.
 */
export function AdminNav({ variant }: { variant: "sidebar" | "strip" }) {
  const t = useTranslations("admin.shell");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  return (
    <nav aria-label={t("title")}>
      <ul
        className={cn(
          variant === "sidebar"
            ? "flex flex-col gap-0.5"
            : "-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]",
        )}
      >
        {ADMIN_SECTIONS.map((section) => {
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
          const href =
            query && usesControls(section.href) ? `${section.href}?${query}` : section.href;
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
