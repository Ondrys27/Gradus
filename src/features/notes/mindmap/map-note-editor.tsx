"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CornerDownRightIcon,
  FileCodeIcon,
  FileTextIcon,
  FileUpIcon,
  ImageIcon,
  NetworkIcon,
  PencilLineIcon,
  PlusIcon,
  Redo2Icon,
  SparklesIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { MindMap, type MindMapDrag } from "@/components/mindmap/mind-map";
import { captureMindMap } from "@/components/mindmap/capture";
import { branchDropTarget, branchKeyboardTarget } from "@/components/mindmap/mind-map-tree";
import { useSession } from "@/features/account/queries";
import { track } from "@/lib/analytics/client";
import { downloadBlob } from "@/lib/download";
import { mapFileName } from "@/features/milestones/map-io";
import { countNodes, type MindMapFormat } from "@/lib/mindmap/formats";
import { formatDateTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { draftFromDoc, type NoteDraft } from "../document";
import { useMentionTargets, useMentionText } from "../mention-queries";
import { mentionKey, mentionSetKey } from "../mentions";
import { Backlinks, SaveStatus } from "../note-editor";
import { applyDraftToCache, NOTE_REPLACED_EVENT, useNoteSaver, type NoteDetail } from "../queries";
import { ConvertDialog } from "./convert-dialog";
import { appendTreeToMap, mapToMindTree, mapToTextDoc, replaceMapWithTree } from "./convert";
import {
  isMapDoc,
  MAP_LIMITS,
  mapDraft,
  mentionsInMap,
  sanitizeMapDoc,
  type MapDoc,
} from "./map-doc";
import {
  canRedo,
  canUndo,
  historyKeyOf,
  pushHistory,
  redoHistory,
  startHistory,
  undoHistory,
  type MapHistory,
} from "./map-history";
import { NoteMapImportDialog, type NoteImport } from "./map-import-dialog";
import { NoteMapDragPreview, NoteMapNode } from "./map-node";
import {
  acceptAllSuggestions,
  acceptSuggestion,
  addChild,
  addSibling,
  branchColors,
  findNode,
  focusAfterRemove,
  insertSuggestions,
  moveNode,
  outdentTarget,
  parentOf,
  rejectAllSuggestions,
  rejectSuggestion,
  removeNode,
  stepSelection,
  suggestedIds,
  toBranch,
  updateNode,
  type SuggestedBranch,
} from "./map-ops";
import { NodeDialog } from "./node-dialog";
import { downloadTree, NoteMenu, TEXT_EXPORTS, type TextExport } from "./note-menu";
import { SuggestDialog } from "./suggest-dialog";

type Props = {
  note: NoteDetail;
  readOnly: boolean;
  /** A map just made: its centre is ready to be typed. */
  autoFocus: boolean;
  isPhone: boolean;
  actions: ReactNode;
  back: ReactNode;
  /** The map as a text note: in place (the note becomes text) or as a new note. */
  onConvert: (draft: NoteDraft, how: "replace" | "new") => void;
};

const STEP_KEYS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function ToolButton({
  label,
  onClick,
  disabled,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      data-testid={testId}
      // The node being typed keeps its text: the tap commits it, never loses it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-xl text-ink-soft transition-colors mouse:size-9 [&_svg]:size-[18px]",
        "hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A note that is a mind map: the shared MindMap with the note's own rules.
 * Double click or Enter types a node's text, Tab adds a child, Enter while
 * typing a sibling, Backspace in an empty node deletes it; nodes drag with
 * their subtree, collapse, take a branch colour, a small note and a link.
 * Every change saves itself through the same NoteSaver as text, and ⌘Z / ⌘⇧Z
 * step back and forth while the note is open. On a phone a node is edited in
 * a bottom panel; two fingers move and zoom the map.
 */
export function MapNoteEditor({ note, readOnly, autoFocus, isPhone, actions, back, onConvert }: Props) {
  const t = useTranslations("notes.map");
  const tNotes = useTranslations("notes");
  const tio = useTranslations("milestones.mapIo");
  const { user } = useSession();
  const queryClient = useQueryClient();
  const saver = useNoteSaver();
  const settings = useFormatSettings();
  const mentionText = useMentionText();
  const reduceMotion = useReducedMotionSafe() ?? false;
  const containerRef = useRef<HTMLDivElement>(null);

  const historyRef = useRef<MapHistory>(
    startHistory(isMapDoc(note.content) ? note.content : sanitizeMapDoc(note.content)),
  );
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const doc = historyRef.current.present;

  const [selectedId, setSelectedId] = useState<string | null>(() => doc.root.id);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(() =>
    autoFocus && !readOnly && !isPhone && !doc.root.title ? { id: doc.root.id, value: "" } : null,
  );
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [details, setDetails] = useState<string | null>(null);
  const [suggestFor, setSuggestFor] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ file: File | null } | null>(null);
  const [converting, setConverting] = useState(false);
  const [alignKey, setAlignKey] = useState<number | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  /** The next render moves the keyboard focus to the selected node. */
  const focusSelected = useRef(false);
  /** Collapse state lives in the map; a node gets its children shown before one is added. */
  const collapsible = useRef(new Map<string, { collapsed: boolean; toggle: () => void }>());
  const justDragged = useRef(false);

  // --- saving -------------------------------------------------------------

  const persist = useCallback(
    (next: MapDoc) => {
      const draft = mapDraft(next, { mentionText });
      saver.edit(note.id, draft);
      applyDraftToCache(queryClient, user.id, note.id, draft);
    },
    [mentionText, note.id, queryClient, saver, user.id],
  );

  /** One step: the map changes, is saved, and can be undone. */
  const change = useCallback(
    (next: MapDoc) => {
      if (readOnly || next === historyRef.current.present) return;
      historyRef.current = pushHistory(historyRef.current, next);
      persist(next);
      rerender();
    },
    [persist, readOnly],
  );

  const undo = useCallback(() => {
    if (readOnly || !canUndo(historyRef.current)) return;
    historyRef.current = undoHistory(historyRef.current);
    persist(historyRef.current.present);
    setEditing(null);
    setSelectedId((id) => (id && findNode(historyRef.current.present, id) ? id : historyRef.current.present.root.id));
    rerender();
  }, [persist, readOnly]);

  const redo = useCallback(() => {
    if (readOnly || !canRedo(historyRef.current)) return;
    historyRef.current = redoHistory(historyRef.current);
    persist(historyRef.current.present);
    setEditing(null);
    setSelectedId((id) => (id && findNode(historyRef.current.present, id) ? id : historyRef.current.present.root.id));
    rerender();
  }, [persist, readOnly]);

  // Leaving the note sends its last change right away.
  useEffect(() => {
    const id = note.id;
    return () => {
      void saver.flush(id);
    };
  }, [note.id, saver]);

  // A branch added from outside (one of Jarvis's answers) shows here too.
  useEffect(() => {
    const onReplaced = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; content: unknown }>).detail;
      if (detail?.id !== note.id || !isMapDoc(detail.content)) return;
      historyRef.current = pushHistory(historyRef.current, sanitizeMapDoc(detail.content));
      rerender();
    };
    window.addEventListener(NOTE_REPLACED_EVENT, onReplaced);
    return () => window.removeEventListener(NOTE_REPLACED_EVENT, onReplaced);
  }, [note.id]);

  // --- derived ------------------------------------------------------------

  const tree = useMemo(() => toBranch(doc.root), [doc]);
  const colors = useMemo(() => branchColors(doc), [doc]);
  const mentions = useMemo(() => mentionsInMap(doc), [doc]);
  const mentionsKey = mentionSetKey(mentions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableMentions = useMemo(() => mentions, [mentionsKey]);
  const targets = useMentionTargets(stableMentions);
  const suggestions = useMemo(() => suggestedIds(doc), [doc]);
  const selected = selectedId ? findNode(doc, selectedId) : null;

  // --- editing ------------------------------------------------------------

  /** The typed title goes into the map (one undo step) and typing stops. */
  const commitEdit = useCallback((): MapDoc => {
    const current = editingRef.current;
    if (!current) return historyRef.current.present;
    editingRef.current = null;
    setEditing(null);
    const node = findNode(historyRef.current.present, current.id);
    if (node && node.title !== current.value.replace(/\s+/g, " ").trim()) {
      const max = node.id === historyRef.current.present.root.id ? MAP_LIMITS.rootTitle : MAP_LIMITS.title;
      change(updateNode(historyRef.current.present, current.id, { title: current.value.replace(/\s+/g, " ").trim().slice(0, max) }));
    }
    return historyRef.current.present;
  }, [change]);

  const startEdit = useCallback(
    (id: string) => {
      if (readOnly) return;
      const node = findNode(historyRef.current.present, id);
      if (!node) return;
      setSelectedId(id);
      if (isPhone) {
        setDetails(id);
        return;
      }
      commitEdit();
      setEditing({ id, value: node.title });
    },
    [commitEdit, isPhone, readOnly],
  );

  const expand = (id: string) => {
    const entry = collapsible.current.get(id);
    if (entry?.collapsed) entry.toggle();
  };

  /** A new node under `parentId` (child) or after `siblingId` (sibling), ready to be typed. */
  const add = useCallback(
    (how: "child" | "sibling", at: string) => {
      if (readOnly) return;
      const base = commitEdit();
      const result = how === "child" ? addChild(base, at) : addSibling(base, at);
      if (!result.id) {
        setNotice(t("full", { max: MAP_LIMITS.nodes }));
        return;
      }
      const parent = how === "child" ? at : (parentOf(base, at)?.id ?? at);
      expand(parent);
      change(result.doc);
      setSelectedId(result.id);
      if (isPhone) setDetails(result.id);
      else setEditing({ id: result.id, value: "" });
    },
    [change, commitEdit, isPhone, readOnly, t],
  );

  const remove = useCallback(
    (id: string) => {
      if (readOnly) return;
      const base = commitEdit();
      if (id === base.root.id) return;
      const next = focusAfterRemove(base, id);
      change(removeNode(base, id));
      setSelectedId(next);
      focusSelected.current = true;
    },
    [change, commitEdit, readOnly],
  );

  const outdent = useCallback(
    (id: string) => {
      const target = outdentTarget(historyRef.current.present, id);
      if (target) change(moveNode(historyRef.current.present, id, target));
    },
    [change],
  );

  function onFieldKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    // The node's own keys stay with the field (⌘ + arrows move the caret, not the node).
    event.stopPropagation();
    const current = editingRef.current;
    if (!current || event.nativeEvent.isComposing) return;
    const isRoot = current.id === historyRef.current.present.root.id;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!current.value.trim()) {
        commitEdit();
        focusSelected.current = true;
        return;
      }
      add(isRoot ? "child" : "sibling", current.id);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) {
        if (isRoot) return;
        commitEdit();
        outdent(current.id);
        setEditing({ id: current.id, value: findNode(historyRef.current.present, current.id)?.title ?? "" });
        return;
      }
      add("child", current.id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      commitEdit();
      focusSelected.current = true;
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && current.value === "" && !isRoot) {
      event.preventDefault();
      const base = historyRef.current.present;
      const previous = focusAfterRemove(base, current.id);
      editingRef.current = null;
      setEditing(null);
      change(removeNode(base, current.id));
      if (previous && previous !== base.root.id) {
        setSelectedId(previous);
        setEditing({ id: previous, value: findNode(historyRef.current.present, previous)?.title ?? "" });
      } else {
        setSelectedId(previous);
        focusSelected.current = true;
      }
    }
  }

  function onNodeKey(id: string, event: KeyboardEvent<HTMLButtonElement>) {
    const isRoot = id === doc.root.id;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    if (plain && STEP_KEYS[event.key] && !event.shiftKey) {
      event.preventDefault();
      const collapsed = new Set(
        [...collapsible.current].filter(([, entry]) => entry.collapsed).map(([key]) => key),
      );
      const next = stepSelection(doc, id, STEP_KEYS[event.key], collapsed);
      if (next) {
        setSelectedId(next);
        focusSelected.current = true;
      }
      return;
    }
    if (!plain || readOnly) {
      if (event.key === "Escape") setSelectedId(null);
      return;
    }
    switch (event.key) {
      case "Enter":
      case "F2":
        event.preventDefault();
        startEdit(id);
        return;
      case "Tab":
        event.preventDefault();
        if (event.shiftKey) {
          if (!isRoot) outdent(id);
          focusSelected.current = true;
          return;
        }
        add("child", id);
        return;
      case "Backspace":
      case "Delete":
        if (!isRoot && !findNode(doc, id)?.title) {
          event.preventDefault();
          remove(id);
        }
        return;
      case "Escape":
        setSelectedId(null);
        return;
    }
  }

  // The keyboard follows the selection after moving it with the keys.
  useEffect(() => {
    if (!focusSelected.current || editing) return;
    focusSelected.current = false;
    if (!selectedId) return;
    requestAnimationFrame(() =>
      containerRef.current
        ?.querySelector<HTMLElement>(`[data-note-map-node="${CSS.escape(selectedId)}"]`)
        ?.focus({ preventScroll: true }),
    );
  });

  // ⌘Z / ⌘⇧Z anywhere in the open map, but not inside a text field (it has its own).
  function onEditorKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    // Dialogs of the map are portals, but their keys bubble here through React.
    if (target.closest("input, textarea, [contenteditable=true], [role=dialog], [role=menu]")) return;
    const action = historyKeyOf(event);
    if (!action) return;
    event.preventDefault();
    if (action === "undo") undo();
    else redo();
  }

  // --- suggestions, import, export, conversion -----------------------------

  function suggested(nodeId: string, branches: SuggestedBranch[]) {
    const result = insertSuggestions(historyRef.current.present, nodeId, branches);
    if (result.ids.length === 0) return;
    expand(nodeId);
    change(result.doc);
    setNotice(t("suggestions.added", { count: result.ids.length }));
  }

  function resolve(action: "accept" | "reject", scope: "one" | "all", id?: string) {
    const base = commitEdit();
    const count = scope === "all" ? suggestedIds(base).length : 1;
    const next =
      scope === "all"
        ? action === "accept"
          ? acceptAllSuggestions(base)
          : rejectAllSuggestions(base)
        : action === "accept"
          ? acceptSuggestion(base, id!)
          : rejectSuggestion(base, id!);
    if (next === base) return;
    change(next);
    if (action === "reject" && id && selectedId === id) setSelectedId(focusAfterRemove(base, id));
    track("note_map_suggestion_resolved", { action, scope, nodes: Math.min(count, 200) });
  }

  function imported(result: NoteImport) {
    const base = commitEdit();
    const next =
      result.mode === "replace" ? replaceMapWithTree(base, result.tree) : appendTreeToMap(base, result.tree);
    change(next);
    setSelectedId(next.root.id);
    setAlignKey(Date.now());
    track("mindmap_imported", {
      format: result.format as MindMapFormat,
      nodes: Math.min(countNodes(result.tree), 5000),
      mode: result.mode === "replace" ? "replace" : "append",
      flattened: false,
      target: "note",
    });
  }

  async function exportAs(format: TextExport | "png") {
    try {
      if (format === "png") {
        const container = containerRef.current;
        if (!container) throw new Error("no map");
        downloadBlob(
          await captureMindMap(container, { reduceMotion }),
          mapFileName(doc.root.title, "png", tio("fileFallback")),
        );
      } else {
        downloadTree(format, mapToMindTree(doc), tio("fileFallback"));
      }
      track("mindmap_exported", { format, from: "note" });
    } catch {
      setNotice(t("exportFailed"));
    }
  }

  function convert(how: "replace" | "new") {
    const base = commitEdit();
    setConverting(false);
    const draft = draftFromDoc(mapToTextDoc(base), { mentionText });
    track("note_converted", { to: "text", how, nodes: Math.min(countNodes(mapToMindTree(base)), 5000) });
    onConvert(draft, how);
  }

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // --- the map --------------------------------------------------------------

  const drag: MindMapDrag<{ parentId: string; index: number }> | undefined = readOnly
    ? undefined
    : {
        resolve: (activeId, overId, zone) => {
          const target = branchDropTarget(tree, activeId, overId, zone);
          return target ? { target, valid: true } : null;
        },
        onDrop: (id, target) => change(moveNode(commitEdit(), id, target)),
        onKeyMove: (id, direction) => {
          const target = branchKeyboardTarget(tree, id, direction);
          if (!target) return;
          change(moveNode(commitEdit(), id, target));
          setSelectedId(id);
          focusSelected.current = true;
        },
        renderPreview: (id, { below, scale }) => {
          const node = findNode(doc, id);
          return node ? (
            <NoteMapDragPreview node={node} color={colors.get(id) ?? null} below={below} scale={scale} />
          ) : null;
        },
        titleOf: (id) => findNode(doc, id)?.title || t("nodePlaceholder"),
        texts: {
          pickedUp: (title) => t("move.pickedUp", { title }),
          over: (title, target) => t("move.over", { title, target }),
          dropped: (title) => t("move.dropped", { title }),
          cancelled: () => t("move.cancelled"),
          instructions: t("move.instructions"),
        },
        justDragged,
      };

  const docKey = useMemo(() => JSON.stringify(doc), [doc]);
  const contentKey = `${docKey}|${editing?.id ?? ""}|${editing?.value ?? ""}|${targets.dataUpdatedAt}`;

  const map = (
    <div
      ref={containerRef}
      onPointerDown={(event) => {
        // A press on the empty map ends typing and the selection.
        const target = event.target as Element;
        // Presses in the map's dialogs bubble here through React portals; they are not the map.
        if (!event.currentTarget.contains(target)) return;
        if (target.closest("[data-testid=note-map-node], [data-map-ui]")) return;
        commitEdit();
        setSelectedId(null);
      }}
    >
      <MindMap
        tree={tree}
        label={t("label")}
        contentKey={contentKey}
        drag={drag}
        alignKey={alignKey}
        onFileDrop={readOnly ? undefined : (file) => setImporting({ file })}
        fileDropLabel={tio("dropOnMap")}
        renderNode={(id, state) => {
          const node = findNode(doc, id);
          if (!node) return null;
          if (!state.measuring) {
            collapsible.current.set(id, { collapsed: state.collapsed, toggle: state.onToggleCollapsed });
          }
          const isEditing = editing?.id === id;
          return (
            <NoteMapNode
              node={node}
              root={id === doc.root.id}
              color={colors.get(id) ?? null}
              measuring={state.measuring}
              selected={selectedId === id}
              editing={
                isEditing
                  ? {
                      value: editing.value,
                      max: id === doc.root.id ? MAP_LIMITS.rootTitle : MAP_LIMITS.title,
                      onChange: (value) => setEditing({ id, value }),
                      onKeyDown: onFieldKey,
                      onBlur: () => {
                        if (editingRef.current?.id === id) commitEdit();
                      },
                    }
                  : null
              }
              target={node.link?.type === "mention" ? targets.data?.get(mentionKey(node.link.attrs.type, node.link.attrs.id)) : undefined}
              childCount={state.childCount}
              hiddenCount={state.hiddenCount}
              collapsed={state.collapsed}
              onToggleCollapsed={state.onToggleCollapsed}
              onSelect={() => {
                if (justDragged.current) return;
                if (editingRef.current && editingRef.current.id !== id) commitEdit();
                // On a phone a second tap on the selected node opens its panel.
                if (isPhone && selectedId === id && !readOnly) setDetails(id);
                setSelectedId(id);
                // Safari does not focus a clicked button; the keys follow the selection anyway.
                if (!isPhone) focusSelected.current = true;
              }}
              onStartEdit={() => startEdit(id)}
              onKeyDown={(event) => onNodeKey(id, event)}
              onAccept={readOnly ? undefined : () => resolve("accept", "one", id)}
              onReject={readOnly ? undefined : () => resolve("reject", "one", id)}
            />
          );
        }}
      />
    </div>
  );

  // --- toolbar --------------------------------------------------------------

  const at = selected ?? doc.root;
  const isRootSelected = at.id === doc.root.id;
  const history = historyRef.current;
  const menu = (
    <NoteMenu
      label={t("menu")}
      groups={[
        ...(readOnly
          ? []
          : [
              {
                items: [
                  {
                    key: "import",
                    label: tio("importButton"),
                    icon: <FileUpIcon aria-hidden />,
                    onSelect: () => setImporting({ file: null }),
                    testId: "note-map-import",
                  },
                ],
              },
            ]),
        {
          label: t("exportLabel"),
          items: [
            ...TEXT_EXPORTS.map((format) => ({
              key: format,
              label: t(`export.${format}`),
              icon: format === "markdown" ? <FileTextIcon aria-hidden /> : format === "opml" ? <FileCodeIcon aria-hidden /> : <NetworkIcon aria-hidden />,
              onSelect: () => void exportAs(format),
              testId: `note-export-${format}`,
            })),
            {
              key: "png",
              label: t("export.png"),
              icon: <ImageIcon aria-hidden />,
              onSelect: () => void exportAs("png"),
              testId: "note-export-png",
            },
          ],
        },
        ...(readOnly
          ? []
          : [
              {
                items: [
                  {
                    key: "toText",
                    label: t("toText"),
                    icon: <FileTextIcon aria-hidden />,
                    onSelect: () => setConverting(true),
                    testId: "note-to-text",
                  },
                ],
              },
            ]),
      ]}
    />
  );

  const editTools = !readOnly && (
    <>
      <ToolButton label={t("undo")} onClick={undo} disabled={!canUndo(history)} testId="note-map-undo">
        <Undo2Icon aria-hidden />
      </ToolButton>
      <ToolButton label={t("redo")} onClick={redo} disabled={!canRedo(history)} testId="note-map-redo">
        <Redo2Icon aria-hidden />
      </ToolButton>
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line/70" />
      <ToolButton label={t("addChild")} onClick={() => add("child", at.id)} testId="note-map-add-child">
        <CornerDownRightIcon aria-hidden />
      </ToolButton>
      <ToolButton label={t("addSibling")} onClick={() => add("sibling", at.id)} testId="note-map-add-sibling">
        <PlusIcon aria-hidden />
      </ToolButton>
      <ToolButton label={t("editDetails")} onClick={() => { commitEdit(); setDetails(at.id); }} testId="note-map-details">
        <PencilLineIcon aria-hidden />
      </ToolButton>
      <ToolButton label={t("deleteNode")} onClick={() => remove(at.id)} disabled={isRootSelected} testId="note-map-delete">
        <Trash2Icon aria-hidden />
      </ToolButton>
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line/70" />
      <ToolButton
        label={t("suggest.button")}
        onClick={() => {
          commitEdit();
          setSuggestFor(at.suggested ? doc.root.id : at.id);
        }}
        testId="note-map-suggest"
      >
        <SparklesIcon aria-hidden />
      </ToolButton>
    </>
  );

  const detailsNode = details ? findNode(doc, details) : null;
  const suggestNode = suggestFor ? findNode(doc, suggestFor) : null;

  return (
    <div className="flex min-h-full flex-col" onKeyDown={onEditorKey}>
      {isPhone ? (
        <div className="sticky top-0 z-10 flex items-center gap-1 bg-canvas px-4 pt-[max(4px,env(safe-area-inset-top))] pb-1">
          {back}
          <span className="flex-1" />
          {!readOnly && (
            <>
              <ToolButton label={t("undo")} onClick={undo} disabled={!canUndo(history)}>
                <Undo2Icon aria-hidden />
              </ToolButton>
              <ToolButton label={t("redo")} onClick={redo} disabled={!canRedo(history)}>
                <Redo2Icon aria-hidden />
              </ToolButton>
            </>
          )}
          {menu}
          {actions}
        </div>
      ) : (
        <div
          role="toolbar"
          aria-label={t("toolbar")}
          className="sticky top-0 z-10 -mx-2 flex items-center gap-1 rounded-2xl bg-canvas/50 px-1 py-1 backdrop-blur-xl"
        >
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto">{editTools}</div>
          {menu}
          <div className="flex shrink-0 items-center">{actions}</div>
        </div>
      )}

      <div className={cn("flex flex-1 flex-col gap-3", isPhone ? "px-4 pb-40" : "pb-16")}>
        <Backlinks noteId={note.id} />
        <p className="mt-3 text-center text-xs text-ink-muted">
          <time dateTime={note.updated_at}>{formatDateTime(new Date(note.updated_at), settings)}</time>
          <span className="mx-2">·</span>
          <SaveStatus noteId={note.id} />
        </p>

        {suggestions.length > 0 && !readOnly && (
          <div
            data-testid="note-map-suggestions"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-dashed border-line-strong bg-surface/50 px-4 py-2.5 text-sm text-ink-soft"
          >
            <SparklesIcon aria-hidden className="size-4 text-violet" />
            <span className="min-w-0 flex-1">{t("suggestions.banner", { count: suggestions.length })}</span>
            <button
              type="button"
              onClick={() => resolve("accept", "all")}
              className="min-h-11 rounded-xl px-3 font-semibold text-green hover:bg-green/10 mouse:min-h-8"
            >
              {t("suggestions.acceptAll")}
            </button>
            <button
              type="button"
              onClick={() => resolve("reject", "all")}
              className="min-h-11 rounded-xl px-3 font-semibold text-pink hover:bg-pink/10 mouse:min-h-8"
            >
              {t("suggestions.rejectAll")}
            </button>
          </div>
        )}

        {map}

        {!isPhone && !readOnly && <p className="text-xs text-ink-muted">{t("hint")}</p>}
        {notice && (
          <p role="status" className="text-sm text-ink-soft">
            {notice}
          </p>
        )}
      </div>

      {/* Phone: what can be done with the selected node, at the thumb. */}
      {isPhone && !readOnly && selected && (
        <div
          role="toolbar"
          aria-label={t("nodeActions")}
          data-testid="note-map-phone-bar"
          className="fixed inset-x-0 bottom-0 z-overlay flex items-center justify-around border-t border-line/50 bg-surface/95 px-2 pt-1 pr-[max(8px,env(safe-area-inset-right))] pb-[max(4px,env(safe-area-inset-bottom))] pl-[max(8px,env(safe-area-inset-left))] backdrop-blur-xl"
        >
          <ToolButton label={t("editDetails")} onClick={() => setDetails(selected.id)}>
            <PencilLineIcon aria-hidden />
          </ToolButton>
          <ToolButton label={t("addChild")} onClick={() => add("child", selected.id)}>
            <CornerDownRightIcon aria-hidden />
          </ToolButton>
          <ToolButton label={t("addSibling")} onClick={() => add("sibling", selected.id)}>
            <PlusIcon aria-hidden />
          </ToolButton>
          <ToolButton label={t("deleteNode")} onClick={() => remove(selected.id)} disabled={selected.id === doc.root.id}>
            <Trash2Icon aria-hidden />
          </ToolButton>
          <ToolButton label={t("suggest.button")} onClick={() => setSuggestFor(selected.suggested ? doc.root.id : selected.id)}>
            <SparklesIcon aria-hidden />
          </ToolButton>
        </div>
      )}

      <NodeDialog
        open={details !== null && !!detailsNode}
        onOpenChange={(open) => {
          if (!open) {
            setDetails(null);
            focusSelected.current = true;
          }
        }}
        node={detailsNode}
        root={detailsNode?.id === doc.root.id}
        shownColor={detailsNode ? (colors.get(detailsNode.id) ?? null) : null}
        target={
          detailsNode?.link?.type === "mention"
            ? targets.data?.get(mentionKey(detailsNode.link.attrs.type, detailsNode.link.attrs.id))
            : undefined
        }
        onSave={(patch) => detailsNode && change(updateNode(historyRef.current.present, detailsNode.id, patch))}
      />
      <SuggestDialog
        open={suggestFor !== null && !!suggestNode}
        onOpenChange={(open) => {
          if (!open) setSuggestFor(null);
        }}
        noteId={note.id}
        node={suggestNode ? { id: suggestNode.id, title: suggestNode.title } : null}
        onSuggested={suggested}
      />
      <NoteMapImportDialog
        open={importing !== null}
        onOpenChange={(open) => {
          if (!open) setImporting(null);
        }}
        existing={countNodes(mapToMindTree(doc))}
        initialFile={importing?.file ?? null}
        onImport={imported}
      />
      <ConvertDialog to={converting ? "text" : null} onClose={() => setConverting(false)} onConvert={convert} />
      {!readOnly && <span className="sr-only">{tNotes("editor.label")}</span>}
    </div>
  );
}
