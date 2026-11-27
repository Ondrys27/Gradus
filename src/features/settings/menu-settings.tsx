"use client";

import { ChevronDownIcon, ChevronUpIcon, EyeIcon, EyeOffIcon, PinIcon, PinOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useNavItems } from "@/components/layout/use-nav";
import { useNavPrefs, useSaveNavPrefs } from "@/components/layout/use-nav-prefs";
import {
  isDefaultNavPrefs,
  MAX_PINNED,
  moveNavItem,
  NAV_ALWAYS,
  navEditorGroups,
  toggleHidden,
  togglePinned,
  EMPTY_NAV_PREFS,
  type NavPrefs,
} from "@/components/layout/nav-prefs";
import type { NavKey } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

/**
 * Settings → Appearance → Menu (30.9): every section the account has, in the
 * groups of the sidebar, with a pin (top of the menu and first in the phone
 * bar), a hide and a move up / down. Saved at once; "Default menu" undoes it
 * all. A hidden section stays reachable by its address and through search.
 */
export function MenuSettings() {
  const t = useTranslations("settings.menu");
  const tNav = useTranslations("nav");
  const { all } = useNavItems();
  const prefs = useNavPrefs();
  const { mutate: save } = useSaveNavPrefs();
  const groups = navEditorGroups(all, prefs);
  const pinFull = prefs.pinned.length >= MAX_PINNED;

  const update = (next: NavPrefs) => {
    if (next !== prefs) save(next);
  };

  return (
    <div className="flex flex-col gap-5" data-tutorial="settings-menu">
      {groups.map((group) => {
        const neighbours: NavKey[] = group.items.map((item) => item.key);
        return (
          <section key={group.key} aria-label={tNav(`groups.${group.key}`)} className="flex flex-col gap-1">
            <h3 className="micro-label px-1 text-ink-muted/80">{tNav(`groups.${group.key}`)}</h3>
            <ul className="flex flex-col">
              {group.items.map((item, index) => {
                const hidden = prefs.hidden.includes(item.key);
                const pinned = prefs.pinned.includes(item.key);
                const name = tNav(item.key);
                return (
                  <li
                    key={item.key}
                    data-menu-row={item.key}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-xl px-2 py-1",
                      hidden && "text-ink-muted",
                    )}
                  >
                    <item.icon aria-hidden className={cn("size-5 shrink-0", hidden ? "opacity-50" : "text-ink-soft")} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {name}
                      {hidden && (
                        <span className="ml-2 text-xs font-normal text-ink-muted">{t("hiddenBadge")}</span>
                      )}
                    </span>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <RowButton
                        label={pinned ? t("unpin", { name }) : t("pin", { name })}
                        disabled={(!pinned && pinFull) || hidden}
                        pressed={pinned}
                        testId={`menu-pin-${item.key}`}
                        onClick={() => update(togglePinned(prefs, item.key))}
                      >
                        {pinned ? <PinOffIcon aria-hidden /> : <PinIcon aria-hidden />}
                      </RowButton>
                      <RowButton
                        label={hidden ? t("show", { name }) : t("hide", { name })}
                        disabled={item.key === NAV_ALWAYS}
                        pressed={hidden}
                        testId={`menu-hide-${item.key}`}
                        onClick={() => update(toggleHidden(prefs, item.key))}
                      >
                        {hidden ? <EyeIcon aria-hidden /> : <EyeOffIcon aria-hidden />}
                      </RowButton>
                      <RowButton
                        label={t("up", { name })}
                        disabled={index === 0}
                        testId={`menu-up-${item.key}`}
                        onClick={() => update(moveNavItem(prefs, neighbours, item.key, -1))}
                      >
                        <ChevronUpIcon aria-hidden />
                      </RowButton>
                      <RowButton
                        label={t("down", { name })}
                        disabled={index === group.items.length - 1}
                        testId={`menu-down-${item.key}`}
                        onClick={() => update(moveNavItem(prefs, neighbours, item.key, 1))}
                      >
                        <ChevronDownIcon aria-hidden />
                      </RowButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-[13px] leading-5 text-ink-muted">
          {t("pinnedHint", { max: MAX_PINNED })} {t("homeHint")}
        </p>
        <Button
          variant="outline"
          size="sm"
          data-testid="menu-reset"
          disabled={isDefaultNavPrefs(prefs)}
          onClick={() => save(EMPTY_NAV_PREFS)}
        >
          {t("reset")}
        </Button>
      </div>
    </div>
  );
}

/** One icon button of a row: its name is the tooltip. */
function RowButton({
  label,
  disabled,
  pressed,
  testId,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  testId: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className={cn("text-ink-muted hover:text-ink", pressed && "text-violet hover:text-violet")}
    >
      {children}
    </Button>
  );
}
