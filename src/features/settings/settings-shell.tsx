"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { normalizeText } from "@/features/search/search-logic";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import {
  SETTINGS_PATH,
  settingsGroupOf,
  settingsItemHref,
  type SettingsGroupDef,
  type SettingsItemDef,
} from "./groups";
import { SettingsSaveProvider } from "./save-state";
import { useVisibleSettings } from "./use-visible-settings";

/** How long the row a deep link landed on stays lit. */
const HIGHLIGHT_MS = 2200;
/** A deep link waits this long for the page's data to render its target. */
const FOCUS_TRIES = 30;
const FOCUS_RETRY_MS = 100;

/**
 * Settings around every settings page: the search, the menu of groups on the
 * left (on a phone the hub is the menu and a group page has a way back) and
 * the deep links `?focus=<element id>` that light a setting up.
 */
export function SettingsShell({ children }: { children: ReactNode }) {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const group = settingsGroupOf(pathname);
  const isHub = group === null;
  const params = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const { groups, items } = useVisibleSettings();
  useSettingsFocus();

  const results = useMemo(() => searchSettings(query, items, groups, t), [query, items, groups, t]);
  const searching = query.trim() !== "";
  const groupTitle = (key: SettingsGroupDef["key"]) => t(`groups.${key}.title`);

  return (
    <SettingsSaveProvider>
      <div className="flex flex-col gap-6 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:items-start md:gap-x-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-x-14">
        <aside
          className={cn("flex flex-col gap-4 md:sticky md:top-24", !isHub && "hidden md:flex")}
          aria-label={t("menuLabel")}
        >
          <header className="flex flex-col gap-1.5 md:hidden">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight text-ink">
              {t("title")}
            </h1>
            <p className="text-sm text-ink-soft">{t("description")}</p>
          </header>
          <p className="hidden text-sm font-semibold text-ink md:block">{t("title")}</p>
          <SettingsSearchField value={query} onChange={setQuery} />
          {searching ? (
            <div className="md:hidden">
              <SearchResults results={results} groupTitle={groupTitle} />
            </div>
          ) : (
            <>
              <nav aria-label={t("menuLabel")} className="hidden md:block">
                <ul className="flex flex-col gap-0.5">
                  {groups.map((item) => {
                    const active = item.key === group;
                    const Icon = item.icon;
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex h-10 items-center gap-2.5 rounded-xl border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
                            active
                              ? "border-violet/50 bg-violet/15 text-ink"
                              : "border-transparent text-ink-soft hover:bg-surface hover:text-ink",
                          )}
                        >
                          <Icon
                            aria-hidden
                            className={cn("size-4 shrink-0", active ? "text-violet" : "text-ink-muted")}
                          />
                          <span className="truncate">{groupTitle(item.key)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              <div className="md:hidden">
                <SettingsGroupList groups={groups} />
              </div>
            </>
          )}
        </aside>

        <div className={cn("flex min-w-0 flex-col gap-5", isHub && !searching && "hidden md:flex")}>
          {!isHub && (
            <Link
              href={SETTINGS_PATH}
              className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-1 text-sm text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
            >
              <ArrowLeftIcon aria-hidden className="size-4" />
              {t("back")}
            </Link>
          )}
          {searching ? (
            <div className="hidden md:block">
              <SearchResults results={results} groupTitle={groupTitle} />
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </SettingsSaveProvider>
  );
}

/** The list of groups with a sentence each: the hub on a phone and on a computer. */
export function SettingsGroupList({ groups }: { groups: SettingsGroupDef[] }) {
  const t = useTranslations("settings.groups");
  return (
    <ul className="flex flex-col divide-y divide-line/60">
      {groups.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              className="group flex min-h-14 items-center gap-3 rounded-xl py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet/15 text-violet">
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-ink">{t(`${item.key}.title`)}</span>
                <span className="text-[13px] leading-5 text-ink-muted">
                  {t(`${item.key}.description`)}
                </span>
              </span>
              <ChevronRightIcon
                aria-hidden
                className="size-4 shrink-0 text-ink-muted transition-colors group-hover:text-ink motion-reduce:transition-none"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SettingsSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("settings.search");
  return (
    <div className="relative">
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
      />
      <Input
        type="search"
        id="settings-search"
        value={value}
        placeholder={t("placeholder")}
        aria-label={t("label")}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        className="pr-10 pl-9"
      />
      {value && (
        <button
          type="button"
          aria-label={t("clear")}
          onClick={() => onChange("")}
          className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}

type SearchResult = { item: SettingsItemDef; label: string };
type SearchGroup = { group: SettingsGroupDef; results: SearchResult[] };

/** Every word of the query starts a word of the label, the keywords or the group name. */
function matchesWords(haystack: string, words: string[]): boolean {
  const tokens = haystack.split(/[\s,./()-]+/).filter(Boolean);
  return words.every((word) => tokens.some((token) => token.startsWith(word)));
}

/** Items that match the query, grouped in menu order. */
function searchSettings(
  query: string,
  items: SettingsItemDef[],
  groups: SettingsGroupDef[],
  t: ReturnType<typeof useTranslations<"settings">>,
): SearchGroup[] {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return groups
    .map((group) => {
      const groupText = normalizeText(t(`groups.${group.key}.title`));
      const results = items
        .filter((item) => item.group === group.key)
        .map((item) => ({ item, label: t(`items.${item.id}.label`) }))
        .filter(({ item, label }) => {
          const haystack = `${normalizeText(label)} ${normalizeText(t(`items.${item.id}.keywords`))} ${groupText}`;
          return matchesWords(haystack, words);
        });
      return { group, results };
    })
    .filter((group) => group.results.length > 0);
}

function SearchResults({
  results,
  groupTitle,
}: {
  results: SearchGroup[];
  groupTitle: (key: SettingsGroupDef["key"]) => string;
}) {
  const t = useTranslations("settings.search");
  if (results.length === 0) {
    return (
      <p role="status" className="py-2 text-sm text-ink-muted">
        {t("empty")}
      </p>
    );
  }
  return (
    <div role="region" aria-label={t("results")} className="flex w-full max-w-[560px] flex-col gap-5">
      {results.map(({ group, results: rows }) => {
        const Icon = group.icon;
        return (
          <section key={group.key} className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 px-1 text-[13px] font-semibold text-ink-muted">
              <Icon aria-hidden className="size-3.5" />
              {groupTitle(group.key)}
            </h2>
            <ul className="flex flex-col">
              {rows.map(({ item, label }) => (
                <li key={item.id}>
                  <Link
                    href={settingsItemHref(item)}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 text-sm text-ink outline-none hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {label}
                    <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * `?focus=<element id>`: scrolls to the control, focuses it and lights its row
 * up for a moment, then drops the parameter so Back or a refresh does not
 * repeat it. Waits a little for the page to render its data.
 */
function useSettingsFocus() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const reduceMotion = useReducedMotionSafe();
  const focus = params.get("focus");
  const handled = useRef<string | null>(null);
  // The lit row outlives the effect: dropping `?focus=` re-runs it, and that
  // must not cancel the timer that turns the highlight off again.
  const lit = useRef<{ row: HTMLElement; timer: number } | null>(null);

  useEffect(
    () => () => {
      if (!lit.current) return;
      window.clearTimeout(lit.current.timer);
      lit.current.row.removeAttribute("data-settings-highlight");
    },
    [],
  );

  useEffect(() => {
    if (!focus || !/^settings-[a-z-]+$/.test(focus)) {
      // Handled and dropped: the same link followed again lights it up again.
      handled.current = null;
      return;
    }
    const key = `${pathname}?${focus}`;
    if (handled.current === key) return;
    let tries = 0;
    let timer: number | undefined;
    const attempt = () => {
      const target = document.getElementById(focus);
      if (!target) {
        if (tries++ < FOCUS_TRIES) timer = window.setTimeout(attempt, FOCUS_RETRY_MS);
        return;
      }
      handled.current = key;
      const row = target.closest<HTMLElement>("[data-setting-row]") ?? target;
      target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      target.focus({ preventScroll: true });
      if (lit.current) {
        window.clearTimeout(lit.current.timer);
        lit.current.row.removeAttribute("data-settings-highlight");
      }
      row.setAttribute("data-settings-highlight", "");
      lit.current = {
        row,
        timer: window.setTimeout(() => {
          row.removeAttribute("data-settings-highlight");
          lit.current = null;
        }, HIGHLIGHT_MS),
      };
      const next = new URLSearchParams(params);
      next.delete("focus");
      const rest = next.toString();
      router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
    };
    attempt();
    return () => window.clearTimeout(timer);
  }, [focus, params, pathname, router, reduceMotion]);
}
