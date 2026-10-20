"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { KIND_ICONS } from "@/features/search/use-search-rows";
import { track } from "@/lib/analytics/client";
import { formatDate } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { MentionMenuBridge } from "./mention-extension";
import { useMentionSearch, type MentionOption } from "./mention-queries";
import { groupByKind } from "./mentions";

/** Choices shown per kind. */
const PER_KIND = 5;
const MENU_WIDTH = 320;
const MENU_MAX_HEIGHT = 320;
const GAP = 6;

/** Where the menu goes: under the caret, or above it when there is no room below. */
function placement(rect: DOMRect | null): React.CSSProperties {
  if (typeof window === "undefined" || !rect) return { display: "none" };
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const width = viewport?.width ?? window.innerWidth;
  const left = Math.max(8, Math.min(rect.left, width - Math.min(MENU_WIDTH, width - 16) - 8));
  const below = height - rect.bottom - GAP;
  if (below >= Math.min(MENU_MAX_HEIGHT, 200) || below >= rect.top) {
    return { left, top: rect.bottom + GAP, maxHeight: Math.min(MENU_MAX_HEIGHT, below - 8) };
  }
  return {
    left,
    bottom: window.innerHeight - rect.top + GAP,
    maxHeight: Math.min(MENU_MAX_HEIGHT, rect.top - GAP - 8),
  };
}

/** The @ menu: records of the user matching what is typed after @, grouped by kind. */
export function MentionMenu({ bridge }: { bridge: MentionMenuBridge }) {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, () => null);
  if (!state) return null;
  return <OpenMenu bridge={bridge} state={state} />;
}

function OpenMenu({
  bridge,
  state,
}: {
  bridge: MentionMenuBridge;
  state: NonNullable<ReturnType<MentionMenuBridge["getSnapshot"]>>;
}) {
  const t = useTranslations("notes.mention");
  const tGroups = useTranslations("search.groups");
  const settings = useFormatSettings();
  const query = useDebouncedValue(state.query.trim(), 150);
  const search = useMentionSearch(query);
  const groups = useMemo(() => groupByKind(search.data ?? [], PER_KIND), [search.data]);
  const flat = useMemo(() => groups.flatMap((group) => group.options), [groups]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const tooShort = state.query.trim().length < 2;

  useEffect(() => setActive(0), [flat]);

  function choose(option: MentionOption) {
    track("note_mention_added", { target: option.type, how: bridge.via });
    state.command({ type: option.type, id: option.id, label: option.label });
  }

  // The editor keeps the focus; its keys come here while the menu is open.
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    bridge.keyHandler = (event) => {
      if (flat.length === 0) return false;
      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
        setActive((index) => (index + 1) % flat.length);
        return true;
      }
      if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
        setActive((index) => (index - 1 + flat.length) % flat.length);
        return true;
      }
      if (event.key === "Enter") {
        const option = flat[Math.min(active, flat.length - 1)];
        if (option) chooseRef.current(option);
        return true;
      }
      return false;
    };
    return () => {
      bridge.keyHandler = null;
    };
  }, [bridge, flat, active]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const status = tooShort
    ? t("typeToSearch")
    : search.isError
      ? t("searchFailed")
      : search.isFetching && flat.length === 0
        ? t("searching")
        : flat.length === 0
          ? t("noResults")
          : null;

  let index = -1;
  return createPortal(
    <div
      ref={listRef}
      role="listbox"
      aria-label={t("menuLabel")}
      data-testid="mention-menu"
      // A tap on a choice must not take the focus (and the caret) from the editor.
      onMouseDown={(event) => event.preventDefault()}
      style={{ ...placement(state.rect), width: `min(${MENU_WIDTH}px, calc(100vw - 16px))` }}
      className="fixed z-popover flex flex-col overflow-y-auto overscroll-contain rounded-2xl border border-line-strong bg-surface p-1.5 shadow-popover"
    >
      {status && <p className="px-3 py-2.5 text-sm text-ink-muted">{status}</p>}
      {groups.map((group) => (
        <div key={group.kind} role="group" aria-label={tGroups(group.kind)} className="flex flex-col">
          <p aria-hidden className="micro-label px-3 pt-2 pb-1">
            {tGroups(group.kind)}
          </p>
          {group.options.map((option) => {
            index += 1;
            const at = index;
            const Icon = KIND_ICONS[option.type];
            const detail =
              option.type === "event" && option.startsAt
                ? formatDate(new Date(option.startsAt), settings)
                : option.detail;
            return (
              <button
                key={`${option.type}:${option.id}`}
                type="button"
                role="option"
                aria-selected={at === active}
                data-index={at}
                data-testid="mention-option"
                onMouseEnter={() => setActive(at)}
                onClick={() => choose(option)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left outline-none mouse:min-h-9",
                  at === active ? "bg-violet/14" : "hover:bg-surface-hover",
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0 text-ink-soft" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-ink">{option.label}</span>
                  {detail && <span className="truncate text-xs text-ink-muted">{detail}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
}
