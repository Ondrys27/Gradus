"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ActivityIcon,
  BotIcon,
  BoxesIcon,
  ChevronDownIcon,
  CoinsIcon,
  CompassIcon,
  GamepadIcon,
  HeartPulseIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MessageSquareIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RepeatIcon,
  ScrollTextIcon,
  SearchIcon,
  ServerCogIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SparklesIcon,
  TrendingUpIcon,
  UsersIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Logo } from "@/components/layout/logo";
import { cn } from "@/lib/utils";
import { ADMIN_PATH } from "../access";
import {
  activeGroup,
  groupsFor,
  isActiveSection,
  type AdminGroupKey,
  type AdminSection,
  type AdminSectionKey,
} from "../nav";
import { parseAdminView, viewQuery } from "../view-state";
import type { AdminRole } from "../roles";
import { useAdminSignOut } from "../admin-session";

const SECTION_ICONS: Record<AdminSectionKey, LucideIcon> = {
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

const GROUP_ICONS: Record<AdminGroupKey, LucideIcon> = {
  overview: LayoutDashboardIcon,
  people: UsersRoundIcon,
  product: BoxesIcon,
  operations: ServerCogIcon,
  settings: Settings2Icon,
};

const SIDEBAR_KEY = "admin.sidebar";

type SidebarState = { collapsed: boolean; closed: AdminGroupKey[] };

function readSidebar(): SidebarState {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      const state = parsed as Partial<SidebarState>;
      return {
        collapsed: state.collapsed === true,
        closed: Array.isArray(state.closed) ? (state.closed as AdminGroupKey[]) : [],
      };
    }
  } catch {
    // Blocked storage: the menu simply starts open.
  }
  return { collapsed: false, closed: [] };
}

function writeSidebar(state: SidebarState) {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, JSON.stringify(state));
  } catch {
    // Nothing to do; the choice just does not survive a reload.
  }
}

/** The shared view (period, filters…) travels with every link; a page's own tab, sort or search stays behind. */
function useKeptQuery(): string {
  const searchParams = useSearchParams();
  return useMemo(() => viewQuery(parseAdminView(new URLSearchParams(searchParams))), [searchParams]);
}

// --- Sidebar ----------------------------------------------------------------------

/**
 * The sections in five groups. Every group folds, and the whole menu folds
 * to a rail of icons; both are remembered in this browser. Links keep the
 * shared view so switching pages keeps the period and filters.
 */
export function AdminSidebar({ role }: { role: AdminRole }) {
  const t = useTranslations("admin.shell");
  const pathname = usePathname();
  const query = useKeptQuery();
  const [state, setState] = useState<SidebarState>({ collapsed: false, closed: [] });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(readSidebar());
    setReady(true);
  }, []);

  function update(next: SidebarState) {
    setState(next);
    writeSidebar(next);
  }

  const groups = groupsFor(role);
  const current = activeGroup(pathname);
  const { collapsed } = state;

  return (
    <div
      className={cn(
        "hidden shrink-0 border-r border-line bg-canvas-deep lg:flex lg:flex-col",
        collapsed ? "w-16" : "w-58",
        ready && "transition-[width] duration-200 motion-reduce:transition-none",
      )}
      data-testid="admin-sidebar"
      data-collapsed={collapsed || undefined}
    >
      <div className="sticky top-0 flex h-dvh flex-col">
        <div className={cn("flex h-14 items-center gap-3 border-b border-line", collapsed ? "justify-center px-2" : "px-4")}>
          <Logo className="size-8 shadow-none" />
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight text-ink">{t("title")}</span>
          )}
        </div>

        <nav aria-label={t("title")} className="flex-1 overflow-y-auto px-2 py-3 [scrollbar-width:thin]">
          <ul className="flex flex-col gap-1">
            {groups.map((group) => {
              const open = !state.closed.includes(group.key);
              const holdsActive = current === group.key;
              const single = group.key === "overview";
              return (
                <li key={group.key} className={cn(group.key !== "overview" && "mt-2")}>
                  {!single && !collapsed && (
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`admin-group-${group.key}`}
                      onClick={() =>
                        update({
                          ...state,
                          closed: open
                            ? [...state.closed, group.key]
                            : state.closed.filter((key) => key !== group.key),
                        })
                      }
                      className="flex h-8 w-full cursor-pointer items-center justify-between rounded-lg px-2 text-xs font-semibold text-ink-muted outline-none hover:text-ink-soft focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span>{t(`groups.${group.key}`)}</span>
                      <ChevronDownIcon
                        aria-hidden
                        className={cn(
                          "size-3.5 transition-transform motion-reduce:transition-none",
                          !open && "-rotate-90",
                        )}
                      />
                    </button>
                  )}
                  {!single && collapsed && <div aria-hidden className="mx-2 mb-2 border-t border-line" />}
                  {/* A folded group still shows the page you are on, so the menu never hides where you are. */}
                  <ul
                    id={`admin-group-${group.key}`}
                    className={cn("flex flex-col gap-0.5", !single && !collapsed && !open && !holdsActive && "hidden")}
                  >
                    {group.sections.map((section) => {
                      const active = isActiveSection(section.href, pathname);
                      if (!single && !collapsed && !open && !active) return null;
                      return (
                        <li key={section.key}>
                          <SidebarLink
                            section={section}
                            active={active}
                            collapsed={collapsed}
                            href={`${section.href}${query}`}
                            label={t(`nav.${section.key}`)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={cn("flex flex-col gap-1 border-t border-line p-2", collapsed && "items-center")}>
          {!collapsed && (
            <p className="px-2 py-1 text-xs text-ink-muted">
              <kbd className="rounded border border-line px-1 font-sans">⌘K</kbd> {t("switcherHint")}
            </p>
          )}
          <SignOutItem collapsed={collapsed} />
          <button
            type="button"
            onClick={() => update({ ...state, collapsed: !collapsed })}
            aria-label={collapsed ? t("expand") : t("collapse")}
            title={collapsed ? t("expand") : t("collapse")}
            className={cn(
              "flex h-9 cursor-pointer items-center gap-2.5 rounded-lg text-sm text-ink-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50",
              collapsed ? "w-9 justify-center" : "px-2",
            )}
          >
            {collapsed ? (
              <PanelLeftOpenIcon aria-hidden className="size-4" />
            ) : (
              <PanelLeftCloseIcon aria-hidden className="size-4" />
            )}
            {!collapsed && <span>{t("collapse")}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

function SidebarLink({
  section,
  active,
  collapsed,
  href,
  label,
}: {
  section: AdminSection;
  active: boolean;
  collapsed: boolean;
  href: string;
  label: string;
}) {
  const Icon = SECTION_ICONS[section.key];
  return (
    // No prefetch: every view is written to the audit, and only real visits count.
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "relative flex h-9 items-center gap-2.5 rounded-lg text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        collapsed ? "w-11 justify-center" : "px-2",
        active ? "bg-surface-hover font-medium text-ink" : "text-ink-soft hover:bg-surface-hover/60 hover:text-ink",
      )}
    >
      {active && (
        <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-violet" />
      )}
      <Icon aria-hidden className={cn("size-4 shrink-0", active ? "text-violet" : "text-ink-muted")} />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

function SignOutItem({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations("admin.shell");
  const { signOut, pending } = useAdminSignOut();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={signOut}
      title={collapsed ? t("signOut") : undefined}
      className={cn(
        "flex h-9 cursor-pointer items-center gap-2.5 rounded-lg text-sm text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        collapsed ? "w-9 justify-center" : "px-2",
      )}
    >
      <LogOutIcon aria-hidden className="size-4" />
      {!collapsed && <span>{t("signOut")}</span>}
    </button>
  );
}

// --- Phone ------------------------------------------------------------------------

/**
 * On a phone the groups sit in a bar along the bottom edge. A group with
 * one page opens it; the others open a sheet with their pages. There is no
 * Jarvis in the administration, so the bar may use the whole width.
 */
export function AdminBottomNav({ role }: { role: AdminRole }) {
  const t = useTranslations("admin.shell");
  const pathname = usePathname();
  const router = useRouter();
  const query = useKeptQuery();
  const [openGroup, setOpenGroup] = useState<AdminGroupKey | null>(null);
  const groups = groupsFor(role);
  const current = activeGroup(pathname);
  const sheet = groups.find((group) => group.key === openGroup);

  return (
    <>
      <nav
        aria-label={t("title")}
        className="fixed inset-x-0 bottom-0 z-nav flex h-[calc(60px+env(safe-area-inset-bottom))] items-stretch border-t border-line bg-canvas-deep/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        {groups.map((group) => {
          const Icon = GROUP_ICONS[group.key];
          const active = current === group.key;
          const label = t(`groups.${group.key}`);
          const className = cn(
            "flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
            active ? "font-medium text-ink" : "text-ink-muted",
          );
          const icon = (
            <span
              className={cn(
                "grid h-6 w-10 place-items-center rounded-full",
                active && "bg-violet/20 text-violet",
              )}
            >
              <Icon aria-hidden className="size-4" />
            </span>
          );
          if (group.sections.length === 1) {
            return (
              <Link
                key={group.key}
                href={`${group.sections[0].href}${query}`}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={className}
              >
                {icon}
                <span className="truncate">{label}</span>
              </Link>
            );
          }
          return (
            <button
              key={group.key}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={openGroup === group.key}
              onClick={() => setOpenGroup(group.key)}
              className={className}
            >
              {icon}
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </nav>

      <BottomSheet
        open={sheet !== undefined}
        onOpenChange={(open) => !open && setOpenGroup(null)}
        title={sheet ? t(`groups.${sheet.key}`) : ""}
        closeLabel={t("close")}
      >
        <ul className="flex flex-col gap-1">
          {sheet?.sections.map((section) => {
            const Icon = SECTION_ICONS[section.key];
            const active = isActiveSection(section.href, pathname);
            return (
              <li key={section.key}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    setOpenGroup(null);
                    router.push(`${section.href}${query}`);
                  }}
                  className={cn(
                    "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active ? "bg-surface-hover font-medium text-ink" : "text-ink-soft",
                  )}
                >
                  <Icon aria-hidden className={cn("size-4", active ? "text-violet" : "text-ink-muted")} />
                  {t(`nav.${section.key}`)}
                </button>
              </li>
            );
          })}
        </ul>
      </BottomSheet>
    </>
  );
}

/** The small header of a phone: the mark, the name and the sign-out. */
export function AdminPhoneBar() {
  const t = useTranslations("admin.shell");
  const { signOut, pending } = useAdminSignOut();
  return (
    <div className="flex h-12 items-center gap-3 border-b border-line bg-canvas-deep px-4 pt-[env(safe-area-inset-top)] lg:hidden">
      <Logo className="size-7 shadow-none" />
      <span className="text-sm font-semibold tracking-tight text-ink">{t("title")}</span>
      <button
        type="button"
        disabled={pending}
        onClick={signOut}
        aria-label={t("signOut")}
        className="ml-auto grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <LogOutIcon aria-hidden className="size-4" />
      </button>
    </div>
  );
}

// --- Keyboard ---------------------------------------------------------------------

/** ⌘K / Ctrl+K: the section switcher; `/`: the search field of the page, or the Users page. */
function isSwitcherShortcut(event: globalThis.KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest("[role=dialog]") !== null
  );
}

/**
 * The keyboard of the administration and the ⌘K switcher: type a few
 * letters of a section, Enter opens it with the current view kept.
 */
export function AdminHotkeys({ role }: { role: AdminRole }) {
  const t = useTranslations("admin.shell");
  const router = useRouter();
  const query = useKeptQuery();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.repeat) return;
      if (isSwitcherShortcut(event)) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target)) {
        const field = document.querySelector<HTMLInputElement>("[data-admin-search]");
        event.preventDefault();
        if (field) {
          field.focus();
          field.select();
        } else {
          router.push(`${ADMIN_PATH}/uzivatele${query}`);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, query]);

  useEffect(() => {
    if (!open) {
      setText("");
      setCursor(0);
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  const needle = text.trim().toLocaleLowerCase();
  const rows = groupsFor(role).flatMap((group) =>
    group.sections
      .map((section) => ({ section, group: group.key, label: t(`nav.${section.key}`) }))
      .filter((row) => !needle || row.label.toLocaleLowerCase().includes(needle)),
  );
  const selected = Math.min(cursor, Math.max(0, rows.length - 1));

  function go(section: AdminSection) {
    setOpen(false);
    router.push(`${section.href}${query}`);
  }

  function onListKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => Math.min(rows.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter" && rows[selected]) {
      event.preventDefault();
      go(rows[selected].section);
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen} title={t("switcher.title")} closeLabel={t("close")}>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="admin-switcher-list"
            aria-activedescendant={rows[selected] ? `admin-switcher-${rows[selected].section.key}` : undefined}
            aria-autocomplete="list"
            value={text}
            placeholder={t("switcher.placeholder")}
            onChange={(event) => {
              setText(event.target.value);
              setCursor(0);
            }}
            onKeyDown={onListKey}
            className="h-11 w-full rounded-xl border border-line bg-canvas pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/30"
          />
        </div>
        <ul id="admin-switcher-list" role="listbox" className="flex max-h-80 flex-col overflow-y-auto">
          {rows.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">{t("switcher.empty")}</li>}
          {rows.map((row, index) => {
            const Icon = SECTION_ICONS[row.section.key];
            const active = index === selected;
            return (
              <li
                key={row.section.key}
                id={`admin-switcher-${row.section.key}`}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setCursor(index)}
                onClick={() => go(row.section)}
                className={cn(
                  "flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm",
                  active ? "bg-surface-hover text-ink" : "text-ink-soft",
                )}
              >
                <Icon aria-hidden className={cn("size-4", active ? "text-violet" : "text-ink-muted")} />
                <span className="flex-1">{row.label}</span>
                <span className="text-xs text-ink-muted">{t(`groups.${row.group}`)}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-ink-muted">{t("switcher.hint")}</p>
      </div>
    </ResponsiveDialog>
  );
}
