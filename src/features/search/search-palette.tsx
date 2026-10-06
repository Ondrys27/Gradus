"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
  LoaderCircleIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useAnimationsEnabled } from "@/lib/animation-preference";
import { useIsMac } from "@/lib/use-is-mac";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { useCan } from "@/features/account/workspace-queries";
import { useGlobalSearch, useSaveSearchHistory, useSearchHistory } from "./queries";
import {
  highlight,
  jumpGroup,
  moveSelection,
  pushRecentItem,
  pushRecentSearch,
  shouldQueryDatabase,
  tidyQuery,
  type DbKind,
  type ResultKind,
} from "./search-logic";
import { KIND_ICONS, useSearchRows, type Row, type RowGroup } from "./use-search-rows";

/** Typing settles for this long before the database is asked. */
const DEBOUNCE_MS = 150;

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/** The ⌘K window: centred in the upper third, full screen on a phone. */
export function SearchPalette({ open, onOpenChange }: Props) {
  const t = useTranslations("search");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-overlay bg-canvas/60 backdrop-blur-md transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          aria-label={t("dialog.title")}
          className={cn(
            "fixed inset-0 z-overlay flex flex-col outline-none transition-opacity duration-150 data-ending-style:opacity-0",
            "md:inset-auto md:top-[max(12dvh,72px)] md:left-1/2 md:w-[min(100vw-64px,640px)] md:-translate-x-1/2",
          )}
        >
          <PaletteBody onClose={() => onOpenChange(false)} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const t = useTranslations("search");
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const osReducedMotion = useReducedMotion();
  const animationsEnabled = useAnimationsEnabled();
  const reduceMotion = osReducedMotion || !animationsEnabled;

  const isMac = useIsMac();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<DbKind | null>(null);
  const [selected, setSelected] = useState(0);
  const debounced = useDebouncedValue(tidyQuery(query), DEBOUNCE_MS);
  const searching = shouldQueryDatabase(debounced);

  const results = useGlobalSearch(debounced, expanded ? [expanded] : null);
  const history = useSearchHistory(true);
  const saveHistory = useSaveSearchHistory();

  // Rows follow what was typed immediately for the app's own pages; database
  // rows follow the debounced query, keeping the previous ones meanwhile.
  const groups = useSearchRows({
    query: tidyQuery(query) ? query : "",
    hits: searching && tidyQuery(query) ? results.data : undefined,
    history: history.data,
    expanded,
  });

  // Offering a new contact makes sense only to someone who may add one.
  const canCreateContact = useCan("contacts", "edit");
  const createRow: Row | null = useMemo(() => {
    const tidy = tidyQuery(query);
    if (!tidy || expanded || !canCreateContact) return null;
    return {
      key: "create",
      kind: "create",
      id: "create",
      title: t("empty.createContact", { query: tidy }),
      context: null,
      href: `/app/kontakty?new=contact&name=${encodeURIComponent(tidy)}`,
      icon: KIND_ICONS.create,
      rank: 0,
    };
  }, [query, expanded, t, canCreateContact]);

  const settled = tidyQuery(query) === debounced && (!searching || !results.isFetching);
  const nothingFound =
    tidyQuery(query) !== "" && groups.length === 0 && settled && !results.isError;
  const visibleGroups: RowGroup[] =
    nothingFound && createRow
      ? [{ key: "create", label: "", rows: [createRow], showAll: null }]
      : groups;
  const rows = visibleGroups.flatMap((group) => group.rows);
  const sizes = visibleGroups.map((group) => group.rows.length);
  const current = Math.min(selected, Math.max(rows.length - 1, 0));

  // New results start at the best match.
  const firstKey = rows[0]?.key;
  useEffect(() => setSelected(0), [firstKey, expanded]);

  // The selection stays in view as it moves.
  const optionId = (index: number) => `${listId}-option-${index}`;
  useEffect(() => {
    document.getElementById(optionId(current))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  function remember(row: Row) {
    const base = history.data ?? { searches: [], items: [] };
    const tidy = tidyQuery(query);
    const items =
      row.kind === "create" || row.kind === "recentSearch" || !row.href
        ? base.items
        : pushRecentItem(base.items, {
            kind: row.kind as ResultKind,
            id: row.id,
            title: row.title,
            href: row.href,
          });
    const searches = tidy ? pushRecentSearch(base.searches, tidy) : base.searches;
    saveHistory.mutate({ searches, items });
  }

  function activate(row: Row | undefined, background = false) {
    if (!row) return;
    if (row.fill !== undefined) {
      setQuery(row.fill);
      inputRef.current?.focus();
      return;
    }
    if (!row.href) return;
    remember(row);
    if (background) {
      window.open(row.href, "_blank", "noopener");
      return;
    }
    onClose();
    router.push(row.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        setSelected(moveSelection(current, rows.length, event.key === "ArrowDown" ? 1 : -1));
        break;
      case "Tab":
        if (sizes.length < 2) return;
        event.preventDefault();
        setSelected(jumpGroup(current, sizes, event.shiftKey ? -1 : 1));
        break;
      case "Enter":
        event.preventDefault();
        activate(rows[current], event.metaKey || event.ctrlKey);
        break;
      case "Backspace":
        if (expanded && query === "") setExpanded(null);
        break;
    }
  }

  let offset = 0;
  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={
        reduceMotion
          ? { duration: 0.12 }
          : { type: "spring", stiffness: 460, damping: 34, mass: 0.8 }
      }
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        "md:h-auto md:rounded-3xl md:border md:border-line-strong md:pt-0 md:pb-0 md:shadow-popover",
      )}
    >
      <Dialog.Title className="sr-only">{t("dialog.title")}</Dialog.Title>
      <div className="flex items-center gap-2 border-b border-line/70 px-4 md:px-5">
        {expanded ? (
          <button
            type="button"
            onClick={() => {
              setExpanded(null);
              inputRef.current?.focus();
            }}
            aria-label={t("dialog.back")}
            className="-ml-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowLeftIcon aria-hidden className="size-5" />
          </button>
        ) : (
          <SearchIcon aria-hidden className="size-5 shrink-0 text-ink-muted" />
        )}
        <input
          ref={inputRef}
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={rows.length ? optionId(current) : undefined}
          aria-label={t("dialog.title")}
          placeholder={
            expanded
              ? `${t(`groups.${expanded}`)} · ${t("dialog.placeholder")}`
              : t("dialog.placeholder")
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-16 min-w-0 flex-1 border-0 bg-transparent text-lg text-ink shadow-none outline-none placeholder:text-ink-muted focus-visible:ring-0 md:h-15"
        />
        {searching && results.isFetching && (
          <LoaderCircleIcon
            aria-label={t("dialog.loading")}
            className="size-5 shrink-0 animate-spin text-ink-muted motion-reduce:animate-none"
          />
        )}
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="hidden h-8 shrink-0 cursor-pointer rounded-full px-3 text-sm text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 md:block"
          >
            {t("dialog.clear")}
          </button>
        )}
        <Dialog.Close
          aria-label={t("dialog.close")}
          className="-mr-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
        >
          <XIcon aria-hidden className="size-5" />
        </Dialog.Close>
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label={t("dialog.results")}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 md:max-h-[min(60dvh,520px)]"
      >
        {results.isError && searching ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-sm text-ink-soft">{t("dialog.failed")}</p>
            <button
              type="button"
              onClick={() => void results.refetch()}
              className="h-11 cursor-pointer rounded-full border border-line px-4 text-sm font-medium text-ink outline-none hover:border-line-strong focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t("dialog.retry")}
            </button>
          </div>
        ) : (
          <>
            {nothingFound && (
              <div className="px-4 pt-6 pb-3 text-center">
                <p className="font-medium text-ink">
                  {t("empty.title", { query: tidyQuery(query) })}
                </p>
                <p className="mt-1 text-sm text-ink-soft">{t("empty.hint")}</p>
              </div>
            )}
            {!tidyQuery(query) && rows.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-ink-soft">{t("empty.start")}</p>
            )}
            {visibleGroups.map((group) => {
              const start = offset;
              offset += group.rows.length;
              return (
                <section
                  key={group.key}
                  role="group"
                  aria-label={group.label || undefined}
                  className="py-1"
                >
                  {group.label && (
                    <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1">
                      <h3 className="micro-label">{group.label}</h3>
                      {group.showAll && (
                        <button
                          type="button"
                          onClick={() => {
                            setExpanded(group.showAll);
                            inputRef.current?.focus();
                          }}
                          className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full px-2 text-xs font-medium text-violet outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {t("dialog.showAll")}
                          <ChevronRightIcon aria-hidden className="size-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                  {group.rows.map((row, i) => (
                    <ResultRow
                      key={row.key}
                      id={optionId(start + i)}
                      row={row}
                      query={row.kind === "recentSearch" ? "" : query}
                      selected={start + i === current}
                      onHover={() => setSelected(start + i)}
                      onOpen={(background) => activate(row, background)}
                    />
                  ))}
                </section>
              );
            })}
          </>
        )}
      </div>

      <footer className="hidden items-center gap-4 border-t border-line/70 px-5 py-2.5 text-xs text-ink-muted md:flex">
        <Hint keys={["↑", "↓"]} label={t("hints.move")} />
        <Hint keys={["↵"]} label={t("hints.open")} />
        <Hint keys={[isMac ? "⌘" : "Ctrl", "↵"]} label={t("hints.background")} />
        <Hint keys={["Tab"]} label={t("hints.nextGroup")} />
        <Hint keys={["Esc"]} label={t("hints.close")} className="ml-auto" />
      </footer>
    </motion.div>
  );
}

function Hint({ keys, label, className }: { keys: string[]; label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {keys.map((key) => (
        <kbd
          key={key}
          className="inline-grid h-5 min-w-5 place-items-center rounded-md border border-line bg-canvas/60 px-1 font-sans text-[11px] text-ink-soft"
        >
          {key}
        </kbd>
      ))}
      {label}
    </span>
  );
}

function ResultRow({
  id,
  row,
  query,
  selected,
  onHover,
  onOpen,
}: {
  id: string;
  row: Row;
  query: string;
  selected: boolean;
  onHover: () => void;
  onOpen: (background: boolean) => void;
}) {
  const Icon = row.icon;
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onMouseMove={selected ? undefined : onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => onOpen(event.metaKey || event.ctrlKey)}
      className={cn(
        "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors md:min-h-11",
        selected ? "bg-violet/20 text-ink" : "text-ink-soft",
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg border",
          selected
            ? "border-violet/50 bg-violet/15 text-ink"
            : "border-line bg-canvas/40 text-ink-muted",
        )}
      >
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-ink">
          <Highlighted text={row.title} query={row.kind === "create" ? "" : query} />
        </span>
        {row.context && (
          <span className="truncate text-xs text-ink-muted">
            <Highlighted text={row.context} query={query} />
          </span>
        )}
      </span>
      {selected && (
        <CornerDownLeftIcon
          aria-hidden
          className="hidden size-4 shrink-0 text-ink-muted md:block"
        />
      )}
    </div>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const segments = useMemo(() => (query ? highlight(text, query) : null), [text, query]);
  if (!segments) return <>{text}</>;
  return (
    <>
      {segments.map((segment, i) =>
        segment.match ? (
          <mark key={i} className="rounded-sm bg-violet/30 text-ink">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}
