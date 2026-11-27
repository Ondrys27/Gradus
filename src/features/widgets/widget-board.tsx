"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import {
  CheckIcon,
  LayoutGridIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Undo2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addItem,
  MAX_ITEMS,
  moveItem,
  newItemId,
  removeItem,
  resizeItem,
  sameItems,
  updateSettings,
  type LayoutItem,
} from "./grid";
import type { useBoardEditor } from "./use-board-editor";
import { useUndoShortcut } from "./use-board-editor";
import { haptic, type Rect } from "./motion";
import type { CoreWidgetMeta as WidgetMeta } from "./meta";
import { WidgetSystemProvider, type WidgetSystem } from "./system";
import { WidgetDetail, type Arrival } from "./widget-frame";
import { useGridEntries, WidgetGrid, type GridEntry } from "./widget-grid";

// The gallery and the settings load only when opened.
const WidgetGallery = dynamic(
  () => import("./widget-gallery").then((module) => module.WidgetGallery),
  {
    ssr: false,
  },
);
const WidgetSettingsDialog = dynamic(
  () => import("./widget-settings-dialog").then((module) => module.WidgetSettingsDialog),
  { ssr: false },
);

type Editor = ReturnType<typeof useBoardEditor>;

/**
 * One dashboard of widgets with everything to shape it (28.5): Edit (or a
 * long press) makes the widgets wiggle; they move by dragging, change size
 * from the corner, go with the cross and are set up with the gear. "Add
 * widget" opens the gallery. ⌘Z takes back the last change, everything saves
 * by itself. A tap on a widget opens its detail. The same board edits the
 * owner's defaults of the company (`template`).
 */
export function WidgetBoard({
  editor,
  system,
  scope,
  template,
  banner,
  leading,
  onReset,
  resetLabel,
  openWidgetKey,
  onOpenWidgetKeyHandled,
}: {
  editor: Editor;
  /** The kind of board: its catalog, rules, names and widgets (system.tsx). */
  system: WidgetSystem;
  scope: string;
  /** Editing the owner's default for the company, a group or a person. */
  template?: { kind: "space" | "group" | "worker"; label: string };
  banner?: ReactNode;
  /** At the start of the toolbar row (the tabs of one's own dashboards). */
  leading?: ReactNode;
  onReset?: () => void;
  resetLabel?: string;
  /** `?widget=<key>`: open that widget's detail once the board is there. */
  openWidgetKey?: string | null;
  onOpenWidgetKeyHandled?: () => void;
}) {
  const t = useTranslations("dashboard.board");
  const track = system.track;
  const [editing, setEditing] = useState(Boolean(template));
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [settingsFor, setSettingsFor] = useState<GridEntry | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const dragStart = useRef<LayoutItem[] | null>(null);

  const items = editor.items;
  const visible = useMemo(() => (items ? system.visible(items) : []), [items, system]);
  const effective = useCallback(
    (item: LayoutItem) => {
      const meta = system.meta(item.widget);
      return meta ? system.effective(meta, item.settings) : item.settings;
    },
    [system],
  );
  const entries = useGridEntries(system, visible, effective);
  const available = system.available;
  // Gallery previews draw with the defaults the account may use, one object per widget.
  const previewSettings = useMemo(
    () => new Map(available.map((meta) => [meta.key, system.effective(meta, {})])),
    [available, system],
  );
  const previewSettingsFor = useCallback(
    (meta: WidgetMeta) => previewSettings.get(meta.key) ?? {},
    [previewSettings],
  );
  const open = entries.find((entry) => entry.item.id === openId) ?? null;

  // The gallery suggests widgets (the app: of the sections the person has opened).
  const placedKeys = useMemo(() => visible.map((item) => item.widget), [visible]);
  const recommended = useMemo(
    () => (system.recommend ? system.recommend(available, placedKeys) : []),
    [system, available, placedKeys],
  );

  useUndoShortcut(editing || Boolean(template), editor.undo);

  // Esc ends editing when nothing else is open.
  useEffect(() => {
    if (!editing || template) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !galleryOpen && !settingsFor) setEditing(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, template, galleryOpen, settingsFor]);

  // A link may ask for a widget's detail (`?widget=pipeline`).
  useEffect(() => {
    if (!openWidgetKey || entries.length === 0) return;
    const entry = entries.find((candidate) => candidate.meta.key === openWidgetKey);
    if (entry) {
      setOpenId(entry.item.id);
      track?.({ type: "widget_opened", widget: entry.meta.key, size: entry.item.size });
    }
    onOpenWidgetKeyHandled?.();
  }, [openWidgetKey, entries, onOpenWidgetKeyHandled, track]);

  function startEditing(via: "button" | "long_press") {
    if (editing) return;
    setEditing(true);
    track?.({ type: "edit_started", via, ...(template ? { template: template.kind } : {}) });
  }

  function add(widget: string, size: LayoutItem["size"], from: Rect | null) {
    if (!items || !system.meta(widget)) return;
    const id = newItemId();
    const next = addItem(items, { id, widget, size, x: 0, y: 0, settings: {} });
    if (next.length === items.length) return;
    editor.apply(next);
    setArrival({ id, from });
    haptic("drop");
    setGalleryOpen(false);
    track?.({ type: "widget_added", widget, size, count: next.length });
  }

  const closeDetail = useCallback(() => setOpenId(null), []);

  if (!items) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-hidden>
        <Skeleton className="col-span-2 row-span-2 h-[344px] rounded-card" />
        <Skeleton className="col-span-2 h-[164px] rounded-card" />
        <Skeleton className="h-[164px] rounded-card" />
        <Skeleton className="h-[164px] rounded-card" />
      </div>
    );
  }

  const full = items.length >= MAX_ITEMS;

  return (
    <WidgetSystemProvider system={system}>
    <div
      className="flex flex-col gap-4"
      data-testid="widget-board"
      data-editing={editing ? "true" : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        {leading}
        {template && (
          <p className="mr-auto text-sm text-ink-soft" data-testid="template-label">
            {template.label}
          </p>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editing && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!editor.canUndo}
                onClick={editor.undo}
                data-testid="board-undo"
                data-tutorial="dashboard-undo"
                title={t("undoHint")}
              >
                <Undo2Icon aria-hidden data-icon="inline-start" />
                {t("undo")}
              </Button>
              {onReset && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setResetting(true)}
                  data-testid="board-reset"
                  data-tutorial="dashboard-reset"
                >
                  <RotateCcwIcon aria-hidden data-icon="inline-start" />
                  {resetLabel ?? t("reset")}
                </Button>
              )}
            </>
          )}
          {(editing || entries.length === 0) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={full}
              onClick={() => setGalleryOpen(true)}
              data-testid="board-add"
              data-tutorial="dashboard-add-widget"
            >
              <PlusIcon aria-hidden data-icon="inline-start" />
              {t("add")}
            </Button>
          )}
          {!template && (
            <Button
              type="button"
              variant={editing ? "default" : "outline"}
              size="sm"
              onClick={() => (editing ? setEditing(false) : startEditing("button"))}
              data-testid="board-edit"
              data-tutorial="dashboard-edit"
            >
              {editing ? (
                <CheckIcon aria-hidden data-icon="inline-start" />
              ) : (
                <PencilIcon aria-hidden data-icon="inline-start" />
              )}
              {editing ? t("done") : t("edit")}
            </Button>
          )}
        </div>
      </div>

      {banner}
      {editor.saving === "failed" && (
        <FormAlert>
          <span className="flex flex-wrap items-center gap-2">
            {t("saveFailed")}
            <Button type="button" variant="outline" size="sm" onClick={() => void editor.retry()}>
              {t("retry")}
            </Button>
          </span>
        </FormAlert>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={<LayoutGridIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Button
              type="button"
              onClick={() => setGalleryOpen(true)}
              data-testid="board-add-first"
            >
              <PlusIcon aria-hidden data-icon="inline-start" />
              {t("add")}
            </Button>
          }
        />
      ) : (
        <WidgetGrid
          entries={entries}
          editing={editing}
          scope={scope}
          arrival={arrival}
          onOpen={(entry) => {
            setOpenId(entry.item.id);
            track?.({ type: "widget_opened", widget: entry.meta.key, size: entry.item.size });
          }}
          onLongPress={template ? undefined : () => startEditing("long_press")}
          onRemove={(entry) => {
            editor.apply(removeItem(items, entry.item.id));
            track?.({ type: "widget_removed", widget: entry.meta.key });
          }}
          onResize={(entry, size) => {
            if (size === entry.item.size) return;
            editor.apply(resizeItem(items, entry.item.id, size));
            track?.({ type: "widget_resized", widget: entry.meta.key, size });
          }}
          onSettings={(entry) => setSettingsFor(entry)}
          onDragStart={() => {
            dragStart.current = items;
          }}
          onDragOver={(activeId, overId) => {
            const current = editor.current() ?? items;
            const index = current.findIndex((item) => item.id === overId);
            if (index < 0) return false;
            const next = moveItem(current, activeId, index);
            // Already in that place: no new render (each one makes dnd-kit measure again).
            if (sameItems(current, next)) return false;
            editor.preview(next);
            return true;
          }}
          onDragEnd={(commit, activeId) => {
            const before = dragStart.current;
            dragStart.current = null;
            if (!before) return;
            if (!commit) {
              editor.commit(before, before);
              return;
            }
            const after = editor.current() ?? before;
            editor.commit(before, after);
            const moved = after.find((item) => item.id === activeId);
            const changed =
              before.findIndex((item) => item.id === activeId) !==
              after.findIndex((item) => item.id === activeId);
            if (moved && changed && system.meta(moved.widget)) {
              track?.({ type: "widget_moved", widget: moved.widget });
            }
          }}
        />
      )}

      {galleryOpen && (
        <WidgetGallery
          open={galleryOpen}
          onOpenChange={setGalleryOpen}
          available={available}
          placed={placedKeys}
          recommended={recommended}
          settingsFor={previewSettingsFor}
          onAdd={(meta, size, from) => add(meta.key, size, from)}
        />
      )}

      {settingsFor && (
        <WidgetSettingsDialog
          meta={settingsFor.meta}
          name={settingsFor.name}
          settings={settingsFor.item.settings}
          system={system}
          onClose={() => setSettingsFor(null)}
          onSave={(settings) => {
            editor.apply(updateSettings(items, settingsFor.item.id, settings));
            track?.({ type: "widget_settings_saved", widget: settingsFor.meta.key });
            setSettingsFor(null);
          }}
        />
      )}

      <AnimatePresence>
        {open && !editing && (
          <WidgetDetail
            key={open.item.id}
            item={open.item}
            meta={open.meta}
            name={system.name(open.meta.key)}
            settings={open.settings}
            scope={scope}
            onClose={closeDetail}
          />
        )}
      </AnimatePresence>

      {onReset && (
        <ConfirmDialog
          open={resetting}
          onOpenChange={setResetting}
          title={resetLabel ?? t("reset")}
          description={t("resetConfirm")}
          confirmLabel={resetLabel ?? t("reset")}
          cancelLabel={t("cancel")}
          closeLabel={t("close")}
          onConfirm={() => {
            setResetting(false);
            onReset();
          }}
        />
      )}
    </div>
    </WidgetSystemProvider>
  );
}
