"use client";

import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  ChevronRightIcon,
  EllipsisIcon,
  FolderIcon,
  FolderPlusIcon,
  NotebookIcon,
  PencilIcon,
  PlusIcon,
  Share2Icon,
  Trash2Icon,
  UsersRoundIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { FOLDER_TEXT } from "./folder-dialog";
import {
  canShare,
  folderCounts,
  folderTree,
  notesInScope,
  type FolderItem,
  type NoteScope,
  type ScopedNote,
} from "./logic";

/** The type of a dragged note: its id. */
export const NOTE_DRAG_TYPE = "application/x-gradus-note";

type Props = {
  scope: NoteScope;
  onScope: (scope: NoteScope) => void;
  notes: readonly ScopedNote[];
  folders: readonly FolderItem[];
  trashOpen: boolean;
  onOpenTrash: () => void;
  readOnly: boolean;
  onNewFolder: (parentId: string | null) => void;
  onEditFolder: (folder: FolderItem) => void;
  onShareFolder: (folder: FolderItem) => void;
  onDeleteFolder: (folder: FolderItem) => void;
  /** A note dropped on a folder (or on My notes = out of folders). */
  onDropNote: (noteId: string, folderId: string | null) => void;
};

const rowClass =
  "flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-[15px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9";
const menuItem =
  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9 [&_svg]:size-4";

/** Accepts a dragged note; highlights while one is over it. */
function useDropTarget(onDrop: (noteId: string) => void, enabled: boolean) {
  const [over, setOver] = useState(false);
  if (!enabled) return { over: false, props: {} };
  return {
    over,
    props: {
      onDragOver: (event: React.DragEvent) => {
        if (!event.dataTransfer.types.includes(NOTE_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: React.DragEvent) => {
        const id = event.dataTransfer.getData(NOTE_DRAG_TYPE);
        setOver(false);
        if (!id) return;
        event.preventDefault();
        onDrop(id);
      },
    },
  };
}

function Count({ value }: { value: number }) {
  const settings = useFormatSettings();
  if (value === 0) return null;
  return <span className="ml-auto shrink-0 text-xs text-ink-muted tabular-nums">{formatNumber(value, {}, settings)}</span>;
}

function FolderRow({
  folder,
  depth,
  count,
  selected,
  expanded,
  hasChildren,
  onToggle,
  props,
}: {
  folder: FolderItem;
  depth: 0 | 1;
  count: number;
  selected: boolean;
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  props: Props;
}) {
  const t = useTranslations("notes.nav");
  const tf = useTranslations("notes.folders");
  const own = folder.role === "owner";
  const writable = own || folder.role === "editor";
  const drop = useDropTarget((id) => props.onDropNote(id, folder.id), writable && !props.readOnly);
  const sharable = canShare(folder.role, folder.canReshare) && !props.readOnly;
  const showMenu = (own && !props.readOnly) || sharable;

  return (
    <li className="relative">
      <div
        {...drop.props}
        className={cn(
          "group/folder flex items-center rounded-xl",
          selected ? "bg-violet/14" : "hover:bg-surface/70",
          drop.over && "ring-2 ring-violet/60",
        )}
      >
        <button
          type="button"
          onClick={() => props.onScope({ kind: "folder", id: folder.id })}
          aria-current={selected ? "true" : undefined}
          data-testid="notes-folder"
          data-folder={folder.id}
          className={cn(rowClass, depth === 1 && "pl-8", showMenu && "pr-1", "min-w-0 flex-1")}
          title={folder.ownerName ? t("sharedBy", { name: folder.ownerName }) : undefined}
        >
          <FolderIcon aria-hidden className={cn("size-4 shrink-0", FOLDER_TEXT[folder.color])} />
          <span className={cn("truncate", selected ? "font-semibold text-ink" : "text-ink-soft")}>
            {folder.name}
          </span>
          {(folder.shared || !own) && (
            <UsersRoundIcon
              aria-label={t("sharedFolder")}
              data-testid="notes-folder-shared"
              className="size-3.5 shrink-0 text-teal"
            />
          )}
          <Count value={count} />
        </button>
        {hasChildren && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? t("collapse", { name: folder.name }) : t("expand", { name: folder.name })}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-8"
          >
            <ChevronRightIcon
              aria-hidden
              className={cn("size-4 transition-transform motion-reduce:transition-none", expanded && "rotate-90")}
            />
          </button>
        )}
        {showMenu && (
          <Menu.Root>
            <Menu.Trigger
              aria-label={t("folderMenu", { name: folder.name })}
              data-testid="notes-folder-menu"
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-8 mouse:opacity-0 mouse:group-focus-within/folder:opacity-100 mouse:group-hover/folder:opacity-100 mouse:data-popup-open:opacity-100"
            >
              <EllipsisIcon aria-hidden className="size-4" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={6} align="end" className="z-popover">
                <Menu.Popup className="min-w-52 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
                  {sharable && (
                    <Menu.Item className={menuItem} onClick={() => props.onShareFolder(folder)} data-testid="notes-folder-share">
                      <Share2Icon aria-hidden />
                      {tf("share")}
                    </Menu.Item>
                  )}
                  {own && !props.readOnly && (
                    <>
                      <Menu.Item className={menuItem} onClick={() => props.onEditFolder(folder)}>
                        <PencilIcon aria-hidden />
                        {tf("edit")}
                      </Menu.Item>
                      {depth === 0 && (
                        <Menu.Item className={menuItem} onClick={() => props.onNewFolder(folder.id)}>
                          <FolderPlusIcon aria-hidden />
                          {tf("subfolder")}
                        </Menu.Item>
                      )}
                      <Menu.Separator className="my-1 h-px bg-line" />
                      <Menu.Item
                        className={cn(menuItem, "text-destructive data-highlighted:text-destructive")}
                        onClick={() => props.onDeleteFolder(folder)}
                      >
                        <Trash2Icon aria-hidden />
                        {tf("delete")}
                      </Menu.Item>
                    </>
                  )}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}
      </div>
    </li>
  );
}

/**
 * The side panel of Notes: My notes · Shared with me · the folders as a
 * tree (one level deep; a note dragged onto a folder goes into it; shared
 * ones carry a people icon) · Trash.
 */
export function NotesNav(props: Props) {
  const t = useTranslations("notes.nav");
  const tt = useTranslations("notes.trash");
  const { scope, onScope, notes, folders, trashOpen, onOpenTrash, readOnly } = props;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const tree = folderTree(folders);
  const counts = folderCounts(notes, folders);
  const mine = notesInScope(notes, { kind: "mine" }).length;
  const shared = notesInScope(notes, { kind: "shared" }).length;
  const dropMine = useDropTarget((id) => props.onDropNote(id, null), !readOnly);
  const current = trashOpen ? null : scope;

  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <nav aria-label={t("label")} className="flex flex-col gap-0.5" data-testid="notes-nav" data-tutorial="notes-nav">
      <div
        {...dropMine.props}
        className={cn("rounded-xl", current?.kind === "mine" ? "bg-violet/14" : "hover:bg-surface/70", dropMine.over && "ring-2 ring-violet/60")}
      >
        <button
          type="button"
          onClick={() => onScope({ kind: "mine" })}
          aria-current={current?.kind === "mine" ? "true" : undefined}
          data-testid="notes-scope-mine"
          className={rowClass}
        >
          <NotebookIcon aria-hidden className="size-4 shrink-0 text-violet" />
          <span className={cn(current?.kind === "mine" ? "font-semibold text-ink" : "text-ink-soft")}>{t("mine")}</span>
          <Count value={mine} />
        </button>
      </div>
      <button
        type="button"
        onClick={() => onScope({ kind: "shared" })}
        aria-current={current?.kind === "shared" ? "true" : undefined}
        data-testid="notes-scope-shared"
        data-tutorial="notes-shared"
        className={cn(rowClass, current?.kind === "shared" ? "bg-violet/14" : "hover:bg-surface/70")}
      >
        <UsersRoundIcon aria-hidden className="size-4 shrink-0 text-teal" />
        <span className={cn(current?.kind === "shared" ? "font-semibold text-ink" : "text-ink-soft")}>{t("shared")}</span>
        <Count value={shared} />
      </button>

      <div className="mt-2 flex items-center justify-between pr-1 pl-3">
        <h2 className="micro-label">{t("folders")}</h2>
        {!readOnly && (
          <button
            type="button"
            onClick={() => props.onNewFolder(null)}
            aria-label={t("newFolder")}
            title={t("newFolder")}
            data-testid="notes-folder-new"
            data-tutorial="notes-folder-new"
            className="grid size-11 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-8"
          >
            <PlusIcon aria-hidden className="size-4" />
          </button>
        )}
      </div>
      {tree.length === 0 ? (
        <p className="px-3 pb-1 text-sm text-ink-muted">{t("noFolders")}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {tree.map((folder) => {
            const expanded = !collapsed.has(folder.id);
            return (
              <li key={folder.id}>
                <ul className="flex flex-col gap-0.5">
                  <FolderRow
                    folder={folder}
                    depth={0}
                    count={counts.get(folder.id) ?? 0}
                    selected={current?.kind === "folder" && current.id === folder.id}
                    expanded={expanded}
                    hasChildren={folder.children.length > 0}
                    onToggle={() => toggle(folder.id)}
                    props={props}
                  />
                  {expanded &&
                    folder.children.map((child) => (
                      <FolderRow
                        key={child.id}
                        folder={child}
                        depth={1}
                        count={counts.get(child.id) ?? 0}
                        selected={current?.kind === "folder" && current.id === child.id}
                        expanded={false}
                        hasChildren={false}
                        onToggle={() => undefined}
                        props={props}
                      />
                    ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={onOpenTrash}
        aria-current={trashOpen ? "true" : undefined}
        data-testid="notes-trash-open"
        data-tutorial="notes-trash"
        className={cn(rowClass, "mt-2 text-sm", trashOpen ? "bg-violet/14 text-ink" : "text-ink-muted hover:text-ink")}
      >
        <Trash2Icon aria-hidden className="size-4" />
        {tt("open")}
      </button>
    </nav>
  );
}
