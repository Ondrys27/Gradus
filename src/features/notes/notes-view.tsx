"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  EyeOffIcon,
  FileUpIcon,
  FolderIcon,
  FolderInputIcon,
  HistoryIcon,
  InfoIcon,
  NetworkIcon,
  PinIcon,
  PinOffIcon,
  Share2Icon,
  SquarePenIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile, useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { industryKeyOf, type IndustryKey } from "@/features/onboarding/industries";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics/client";
import { countNodes } from "@/lib/mindmap/formats";
import { draftFromDoc, EMPTY_DOC, isBlank, type DocNode, type NoteDraft } from "./document";
import { useMentionText } from "./mention-queries";
import { mindTreeToMap } from "./mindmap/convert";
import { NoteMapImportDialog, type NoteImport } from "./mindmap/map-import-dialog";
import { mapDraft, newMapDoc, type MapDoc, type NoteKind } from "./mindmap/map-doc";
import { noteContentOf, noteKindOf } from "./mindmap/note-row";
import { NotesEmpty } from "./notes-empty";
import { NotesList } from "./notes-list";
import { neighbourAfterRemoval, newNoteShortcutOf, orderBySearch } from "./notes-logic";
import { NotesTrash } from "./notes-trash";
import {
  noteKeys,
  useCreateNote,
  useDeleteNote,
  useNote,
  useNoteSaver,
  useNotes,
  useNoteSearch,
  usePinNote,
  useRemoveBlankNote,
  useRestoreNote,
  useRestoreUnsavedNotes,
  applyDraftToCache,
  type NoteDetail,
  type NoteListItem,
} from "./queries";
import { templateDraft, templateMapDraft, type NoteTemplateKey } from "./templates";
import { FOLDER_TEXT, FolderDialog, type FolderDialogState } from "./sharing/folder-dialog";
import {
  canShare,
  canWriteNote,
  folderCounts,
  notesInScope,
  parseScope,
  scopeSearch,
  writableFolders,
  type FolderItem,
  type NoteScope,
} from "./sharing/logic";
import { NoteAccessBar } from "./sharing/note-access-bar";
import { NotesNav } from "./sharing/notes-nav";
import {
  fetchVersion,
  useDeleteFolder,
  useDismissNote,
  useMoveNote,
  useNoteFolders,
  type NoteVersion,
} from "./sharing/queries";
import { ShareDialog, type ShareDialogTarget } from "./sharing/share-dialog";
import { VersionsDialog } from "./sharing/versions-dialog";

const UNDO_MS = 6000;

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-3 pt-16" aria-hidden>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

/** The editor (Tiptap) loads only once a note is open, so the list is never kept waiting. */
const NoteEditor = dynamic(() => import("./note-editor").then((m) => m.NoteEditor), {
  ssr: false,
  loading: EditorSkeleton,
});

/** A map note: the shared mind map loads only once one is open. */
const MapNoteEditor = dynamic(
  () => import("./mindmap/map-note-editor").then((m) => m.MapNoteEditor),
  { ssr: false, loading: EditorSkeleton },
);

export function NotesView() {
  const t = useTranslations("notes");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("note");
  const scope = parseScope(searchParams);
  const scopeKey = scope.kind === "folder" ? `folder:${scope.id}` : scope.kind;
  const isPhone = useIsPhone();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const { readOnly } = useWorkspace();
  const profile = useProfile();
  const saver = useNoteSaver();
  const mentionText = useMentionText();
  const [importOpen, setImportOpen] = useState(false);

  const notes = useNotes();
  useRestoreUnsavedNotes(notes.data);
  const note = useNote(selectedId);
  const folders = useNoteFolders();
  const folderList = useMemo(() => folders.data ?? [], [folders.data]);
  const moveNote = useMoveNote();
  const deleteFolder = useDeleteFolder();
  const dismissNote = useDismissNote();
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null);
  const [shareTarget, setShareTarget] = useState<ShareDialogTarget | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<FolderItem | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [dismissing, setDismissing] = useState<NoteListItem | NoteDetail | null>(null);
  /** Bumped when a version comes back, so the open editor starts from it. */
  const [revision, setRevision] = useState(0);

  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 250);
  const search = useNoteSearch(debounced);
  const [trashOpen, setTrashOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string } | null>(null);
  /** A note the list's bin (or the Delete key) asks to move to the trash. */
  const [confirming, setConfirming] = useState<{ note: NoteListItem; viaKeyboard: boolean } | null>(
    null,
  );
  /** On the phone a note opened from the list was pushed, so Back returns to it. */
  const pushedRef = useRef(false);

  const createNote = useCreateNote();
  const pinNote = usePinNote();
  const deleteNote = useDeleteNote();
  const restoreNote = useRestoreNote();
  const removeBlank = useRemoveBlankNote();

  const industry: IndustryKey | null = profile.industry ? industryKeyOf(profile.industry) : null;

  const results = useMemo(() => {
    if (debounced.length < 2 || !notes.data) return null;
    // The search covers every note the account reaches, whatever part of the panel is open.
    return orderBySearch(
      notes.data,
      (search.data ?? []).map((hit) => hit.id),
    );
  }, [debounced, notes.data, search.data]);

  /** The address of a note (or none) in a part of the panel. */
  const hrefFor = useCallback(
    (id: string | null, where: NoteScope = scope) => {
      const query = new URLSearchParams(scopeSearch(where));
      if (id) query.set("note", id);
      const search = query.toString();
      return search ? `${pathname}?${search}` : pathname;
    },
    // scopeKey stands for scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname, scopeKey],
  );

  const select = useCallback(
    (id: string | null) => {
      const url = hrefFor(id);
      if (isPhone && id && !selectedId) {
        pushedRef.current = true;
        router.push(url, { scroll: false });
      } else {
        router.replace(url, { scroll: false });
      }
    },
    [hrefFor, isPhone, router, selectedId],
  );

  const closeOnPhone = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false;
      router.back();
    } else {
      router.replace(hrefFor(null), { scroll: false });
    }
  }, [hrefFor, router]);

  /** Another part of the side panel: My notes, Shared with me or a folder. */
  const changeScope = useCallback(
    (next: NoteScope) => {
      setTrashOpen(false);
      setQuery("");
      const query = new URLSearchParams(scopeSearch(next));
      const search = query.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  // A computer always shows a note next to the list: the newest one by default,
  // and another one when the address points at a note that is gone.
  const listed = useMemo(
    () => (notes.data ? notesInScope(notes.data, scope, folderList) : undefined),
    // scopeKey stands for scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes.data, scopeKey, folderList],
  );
  const selectedListed = !!selectedId && !!listed?.some((n) => n.id === selectedId);
  useEffect(() => {
    if (isPhone || trashOpen || !listed) return;
    if (selectedId && (selectedListed || note.isPending || note.data)) return;
    const first = listed[0];
    if (first) select(first.id);
    else if (selectedId) select(null);
  }, [isPhone, trashOpen, listed, selectedId, selectedListed, note.isPending, note.data, select]);

  // A note left without any text goes away when the user moves on, like Apple Notes.
  const previousId = useRef<string | null>(selectedId);
  const dropIfBlank = useCallback(
    (id: string) => {
      if (readOnly) return;
      const text =
        saver.latestDraft(id)?.content_text ??
        queryClient.getQueryData<NoteDetail | null>(noteKeys.detail(user.id, id))?.content_text;
      if (text !== undefined && isBlank({ content_text: text })) removeBlank.mutate(id);
    },
    [queryClient, readOnly, removeBlank, saver, user.id],
  );
  useEffect(() => {
    const previous = previousId.current;
    previousId.current = selectedId;
    if (previous && previous !== selectedId) dropIfBlank(previous);
  }, [selectedId, dropIfBlank]);
  const dropRef = useRef(dropIfBlank);
  useEffect(() => {
    dropRef.current = dropIfBlank;
  }, [dropIfBlank]);
  useEffect(() => {
    return () => {
      if (previousId.current) dropRef.current(previousId.current);
    };
  }, []);

  /** The open folder, when the account may put notes into it. */
  const openFolder = scope.kind === "folder" ? folderList.find((folder) => folder.id === scope.id) : undefined;
  const targetFolder =
    openFolder && (openFolder.role === "owner" || openFolder.role === "editor") ? openFolder.id : null;

  /** Opens a note just made (the list, the editor and the address follow it). */
  const openNew = useCallback(
    (id: string) => {
      setJustCreated(id);
      setTrashOpen(false);
      setQuery("");
      // A new note is the account's own: from Shared with me it shows under My notes.
      const where: NoteScope = scope.kind === "shared" ? { kind: "mine" } : scope;
      router.replace(hrefFor(id, where), { scroll: false });
    },
    // scopeKey stands for scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hrefFor, router, scopeKey],
  );

  const newNote = useCallback(
    (
      where: "list" | "empty_state" | "shortcut",
      template?: NoteTemplateKey,
      kind: NoteKind = "text",
    ) => {
      if (readOnly) return;
      const tt = (key: string) => t(`templates.${key}` as "templates.pricing.title");
      const draft = template
        ? kind === "mindmap"
          ? templateMapDraft(template, tt)
          : templateDraft(template, industry, tt)
        : kind === "mindmap"
          ? mapDraft(newMapDoc())
          : draftFromDoc(EMPTY_DOC);
      const id = createNote({
        draft,
        where,
        folderId: targetFolder,
        template: template
          ? { key: template, industry: kind === "mindmap" || industry === "other" ? null : industry }
          : undefined,
      });
      openNew(id);
    },
    [createNote, industry, openNew, readOnly, t, targetFolder],
  );

  /** A note turned into the other kind: in place, or next to the original as a new note. */
  const convertNote = useCallback(
    (id: string, draft: NoteDraft, how: "replace" | "new") => {
      if (readOnly) return;
      if (how === "new") {
        openNew(createNote({ draft, where: "convert", source: "convert", folderId: targetFolder }));
        return;
      }
      saver.edit(id, draft);
      applyDraftToCache(queryClient, user.id, id, draft);
      void saver.flush(id);
    },
    [createNote, openNew, queryClient, readOnly, saver, targetFolder, user.id],
  );

  /** "Import map" in the list: a new map note from the file. */
  const importNew = useCallback(
    (result: NoteImport) => {
      const fallback = result.fileName.replace(/\.[^.]+$/, "");
      const draft = mapDraft(mindTreeToMap(result.tree, fallback), { mentionText });
      openNew(createNote({ draft, where: "list", source: "import", folderId: targetFolder }));
      track("mindmap_imported", {
        format: result.format,
        nodes: Math.min(countNodes(result.tree), 5000),
        mode: "new",
        flattened: false,
        target: "note",
      });
    },
    [createNote, mentionText, openNew, targetFolder],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const kind = newNoteShortcutOf(event);
      if (!kind || readOnly) return;
      // Not over a dialog, the search window or the onboarding.
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      event.preventDefault();
      newNote("shortcut", undefined, kind);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newNote, readOnly]);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  /**
   * Moves a note to the trash with Undo at the bottom. The open note gives way
   * to its neighbour in the list; deleting another note keeps the open one.
   */
  function remove(target: Pick<NoteDetail, "id" | "pinned">, from: "editor" | "list" | "keyboard") {
    const visible = results ?? listed ?? [];
    const next = neighbourAfterRemoval(visible, target.id);
    deleteNote.mutate({ id: target.id, pinned: target.pinned, from });
    setUndo({ id: target.id });
    if (target.id !== selectedId) return;
    if (isPhone) {
      closeOnPhone();
      return;
    }
    const nextId = next && next.id !== target.id ? next.id : null;
    select(nextId);
    // From the keyboard the next note is ready for the next key.
    if (from === "keyboard" && nextId) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-note-row="${CSS.escape(nextId)}"]`)?.focus(),
      );
    }
  }

  function undoRemove() {
    if (!undo) return;
    const id = undo.id;
    setUndo(null);
    restoreNote.mutate(id, { onSuccess: () => select(id) });
  }

  // The very first visit: templates instead of an empty panel.
  const empty =
    !!notes.data &&
    notes.data.length === 0 &&
    (folders.data?.length ?? 0) === 0 &&
    scope.kind === "mine" &&
    !query;
  const detail = selectedId ? note.data : null;
  const role = detail?.role ?? "owner";
  const own = role === "owner";
  const writable = !readOnly && canWriteNote(role);
  const detailFolder = detail?.folder_id ? folderList.find((folder) => folder.id === detail.folder_id) : undefined;
  const listedDetail = detail ? notes.data?.find((item) => item.id === detail.id) : undefined;
  const detailShared = listedDetail?.shared ?? false;
  const movable = writableFolders(folderList);

  const back = (
    <button
      type="button"
      onClick={closeOnPhone}
      className="-ml-2 flex min-h-11 items-center gap-0.5 rounded-xl pr-2 font-semibold text-violet"
    >
      <ChevronLeftIcon className="size-5" />
      {t("back")}
    </button>
  );

  function openShare() {
    if (!detail) return;
    setShareTarget({
      item: { kind: "note", id: detail.id },
      title: detail.title || t("untitled"),
      ownerId: detail.owner_id ?? user.id,
      role,
      canReshare: detail.can_reshare ?? own,
      inFolder: detail.folder_id ? { private: detail.folder_private ?? false } : null,
    });
  }

  /** A version comes back through a normal save; the open editor starts again from it. */
  async function restoreVersion(version: NoteVersion) {
    if (!detail) return;
    const stored = await fetchVersion(version.id);
    const kind = noteKindOf(stored.kind);
    const content = noteContentOf(kind, stored.content) as DocNode | MapDoc;
    const draft: NoteDraft = { kind, title: stored.title, content, content_text: stored.content_text };
    saver.edit(detail.id, draft);
    applyDraftToCache(queryClient, user.id, detail.id, draft);
    await saver.flush(detail.id);
    if (saver.unsavedDraft(detail.id)) throw new Error("note_not_saved");
    setRevision((value) => value + 1);
    track("note_version_restored", { kind, own: version.savedBy === user.id });
  }

  const menuItem =
    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9 [&_svg]:size-4";

  const actions = detail ? (
    <>
      <NoteAccessBar
        noteId={detail.id}
        shared={detailShared}
        onOpen={openShare}
        className="max-md:hidden"
      />
      {canShare(role, detail.can_reshare ?? own) && !readOnly && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("sharing.share")}
          title={t("sharing.share")}
          data-testid="note-share"
          onClick={openShare}
        >
          <Share2Icon />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("versions.open")}
        title={t("versions.open")}
        data-testid="note-versions-open"
        onClick={() => setVersionsOpen(true)}
      >
        <HistoryIcon />
      </Button>
      {own && !readOnly && (
        <>
          <Menu.Root>
            <Menu.Trigger
              aria-label={t("folders.move")}
              title={t("folders.move")}
              data-testid="note-move"
              className="grid size-11 cursor-pointer place-items-center rounded-xl text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8 [&_svg]:size-4"
            >
              <FolderInputIcon aria-hidden />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={6} align="end" className="z-popover">
                <Menu.Popup className="max-h-80 min-w-56 overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
                  {movable.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-ink-muted">{t("folders.moveEmpty")}</p>
                  ) : (
                    <>
                      <Menu.Item
                        className={menuItem}
                        disabled={!detail.folder_id}
                        onClick={() => moveNote.mutate({ noteId: detail.id, folderId: null, via: "menu" })}
                      >
                        <FolderIcon aria-hidden className="text-ink-muted" />
                        {t("folders.moveNone")}
                      </Menu.Item>
                      {movable.map((folder) => (
                        <Menu.Item
                          key={folder.id}
                          className={cn(menuItem, folder.parentId && "pl-8")}
                          disabled={folder.id === detail.folder_id}
                          onClick={() => moveNote.mutate({ noteId: detail.id, folderId: folder.id, via: "menu" })}
                          data-testid="note-move-folder"
                          data-folder={folder.id}
                        >
                          <FolderIcon aria-hidden className={FOLDER_TEXT[folder.color]} />
                          <span className="truncate">{folder.name}</span>
                        </Menu.Item>
                      ))}
                    </>
                  )}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={detail.pinned ? t("unpin") : t("pin")}
            title={detail.pinned ? t("unpin") : t("pin")}
            aria-pressed={detail.pinned}
            onClick={() => pinNote.mutate({ id: detail.id, pinned: !detail.pinned })}
            className={cn(detail.pinned && "text-gold")}
          >
            {detail.pinned ? <PinOffIcon /> : <PinIcon />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("delete")}
            title={t("delete")}
            data-testid="note-delete"
            onClick={() => remove(detail, "editor")}
          >
            <Trash2Icon />
          </Button>
        </>
      )}
      {!own && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("sharing.dismiss")}
          title={t("sharing.dismiss")}
          data-testid="note-dismiss"
          onClick={() => setDismissing(detail)}
        >
          <EyeOffIcon />
        </Button>
      )}
    </>
  ) : null;

  // The note's place among the people it is shared with, quietly above the text.
  const placeNotice = detail ? (
    <div className="flex flex-col gap-1 pb-2">
      {isPhone && (
        <NoteAccessBar noteId={detail.id} shared={detailShared} onOpen={openShare} className="self-start" />
      )}
      {!own && (
        <p className="flex items-center gap-2 text-xs text-ink-muted" data-testid="note-shared-by">
          <InfoIcon aria-hidden className="size-3.5 shrink-0" />
          {[
            listedDetail?.owner_name ? t("sharing.sharedBy", { name: listedDetail.owner_name }) : null,
            role === "viewer" ? t("sharing.viewOnly") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {own && detail.id === justCreated && detailFolder && detailFolder.shared && !detail.folder_private && (
        <p className="flex items-center gap-2 rounded-xl bg-teal/10 px-3 py-2 text-xs text-teal" role="status" data-testid="note-inherited">
          <InfoIcon aria-hidden className="size-3.5 shrink-0" />
          {t("folders.inheritedNotice", { name: detailFolder.name })} {t("folders.inheritedHint")}
        </p>
      )}
    </div>
  ) : null;

  const editorReadOnly = readOnly || !writable;
  const editorPane = detail ? (
    <>
      {placeNotice}
      {detail.kind === "mindmap" ? (
        <MapNoteEditor
          key={`${detail.id}:mindmap:${revision}`}
          note={detail}
          readOnly={editorReadOnly}
          autoFocus={detail.id === justCreated}
          isPhone={isPhone}
          actions={actions}
          back={back}
          onConvert={(draft, how) => convertNote(detail.id, draft, how)}
        />
      ) : (
        <NoteEditor
          key={`${detail.id}:text:${revision}`}
          note={detail}
          readOnly={editorReadOnly}
          autoFocus={detail.id === justCreated}
          isPhone={isPhone}
          actions={actions}
          back={back}
          onConvert={(draft, how) => convertNote(detail.id, draft, how)}
        />
      )}
    </>
  ) : selectedId && note.isPending ? (
    <EditorSkeleton />
  ) : (
    <p className="pt-24 text-center text-sm text-ink-muted">{t("selectNote")}</p>
  );

  // Bottom left of the content, where floating controls go (the right belongs to Grady).
  const undoBar = undo && (
    <div
      role="status"
      data-testid="notes-undo"
      className="fixed bottom-[calc(12px+64px+12px+env(safe-area-inset-bottom))] left-[max(16px,env(safe-area-inset-left))] z-nav flex w-[min(360px,calc(100vw-32px))] items-center justify-between gap-3 rounded-2xl border border-line-strong bg-surface py-1.5 pr-1.5 pl-4 text-sm text-ink-soft shadow-popover md:bottom-[max(24px,env(safe-area-inset-bottom))] md:left-[calc(var(--app-sidebar-width,0px)+24px)] lg:left-[calc(var(--app-sidebar-width,0px)+32px)]"
    >
      <span className="flex items-center gap-2">
        <Trash2Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />
        {t("deleted")}
      </span>
      <button
        type="button"
        onClick={undoRemove}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 font-semibold text-violet outline-none hover:bg-violet/10 focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9"
      >
        <Undo2Icon aria-hidden className="size-4" />
        {t("undo")}
      </button>
    </div>
  );

  const confirmDialog = (
    <ConfirmDialog
      open={!!confirming}
      onOpenChange={(open) => {
        if (!open) setConfirming(null);
      }}
      title={t("deleteConfirm.title", {
        title: confirming?.note.title || t("untitled"),
      })}
      description={t("deleteConfirm.text")}
      confirmLabel={t("deleteConfirm.confirm")}
      cancelLabel={t("deleteConfirm.cancel")}
      closeLabel={t("deleteConfirm.cancel")}
      onConfirm={() => {
        if (!confirming) return;
        const { note: target, viaKeyboard } = confirming;
        setConfirming(null);
        remove(target, viaKeyboard ? "keyboard" : "list");
      }}
    />
  );

  const emptyText =
    scope.kind === "shared" ? t("sharing.emptyShared") : scope.kind === "folder" ? t("folders.empty") : t("sharing.emptyMine");
  const nav = (
    <NotesNav
      scope={scope}
      onScope={changeScope}
      notes={notes.data ?? []}
      folders={folderList}
      trashOpen={trashOpen}
      onOpenTrash={() => setTrashOpen(true)}
      readOnly={readOnly}
      onNewFolder={(parentId) => setFolderDialog({ mode: "new", parentId })}
      onEditFolder={(folder) => setFolderDialog({ mode: "edit", folder })}
      onShareFolder={(folder) =>
        setShareTarget({
          item: { kind: "folder", id: folder.id },
          title: folder.name,
          ownerId: folder.ownerId,
          role: folder.role,
          canReshare: folder.canReshare,
        })
      }
      onDeleteFolder={setFolderToDelete}
      onDropNote={(noteId, folderId) => {
        const dropped = notes.data?.find((item) => item.id === noteId);
        if (!dropped || (dropped.role ?? "owner") !== "owner" || dropped.folder_id === folderId) return;
        moveNote.mutate({ noteId, folderId, via: "drag" });
      }}
    />
  );
  const side = (
    <div className="flex flex-col gap-4">
      {nav}
      {trashOpen ? (
        <NotesTrash
          readOnly={readOnly}
          onClose={() => setTrashOpen(false)}
          onRestored={(id) => {
            setTrashOpen(false);
            select(id);
          }}
        />
      ) : (
        <NotesList
          notes={listed}
          results={results}
          searching={search.isFetching}
          query={query}
          onQueryChange={setQuery}
          selectedId={selectedId}
          onSelect={(id) => select(id)}
          emptyText={emptyText}
          draggable={!readOnly && !isPhone}
          onRequestDelete={
            readOnly ? undefined : (target, viaKeyboard) => setConfirming({ note: target, viaKeyboard })
          }
          loadError={notes.isError && !listed}
          onRetry={() => void notes.refetch()}
        />
      )}
    </div>
  );

  const newButton = !readOnly && (
    <div className="flex items-center">
      <Button
        onClick={() => newNote("list")}
        title={t("newHint")}
        data-testid="note-new"
        data-tutorial="note-new"
        className="rounded-r-none"
      >
        <SquarePenIcon />
        {t("new")}
      </Button>
      <Menu.Root>
        <Menu.Trigger
          aria-label={t("newKind.label")}
          title={t("newKind.label")}
          data-testid="note-new-menu"
          className="grid h-11 w-10 cursor-pointer place-items-center rounded-r-xl border-l border-canvas/30 bg-primary text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 mouse:h-10 mouse:w-9"
        >
          <ChevronDownIcon aria-hidden className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} align="end" className="z-popover">
            <Menu.Popup className="min-w-60 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
              <Menu.Item className={menuItem} onClick={() => newNote("list")} data-testid="note-new-text">
                <SquarePenIcon aria-hidden />
                <span className="flex-1">{t("newKind.text")}</span>
                <kbd className="text-xs text-ink-muted">⌘N</kbd>
              </Menu.Item>
              <Menu.Item
                className={menuItem}
                onClick={() => newNote("list", undefined, "mindmap")}
                data-testid="note-new-map"
              >
                <NetworkIcon aria-hidden />
                <span className="flex-1">{t("newKind.mindmap")}</span>
                <kbd className="text-xs text-ink-muted">⌘⇧N</kbd>
              </Menu.Item>
              <Menu.Separator className="my-1 h-px bg-line" />
              <Menu.Item className={menuItem} onClick={() => setImportOpen(true)} data-testid="note-new-import">
                <FileUpIcon aria-hidden />
                {t("newKind.import")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} actions={newButton} />
      {readOnly && <p className="text-sm text-orange">{t("readOnly")}</p>}

      {empty && !trashOpen ? (
        <NotesEmpty
          readOnly={readOnly}
          onTemplate={(key, kind) => newNote("empty_state", key, kind)}
          onBlank={(kind) => newNote("empty_state", undefined, kind)}
          onOpenTrash={() => setTrashOpen(true)}
        />
      ) : isPhone ? (
        <>
          {side}
          {selectedId && (
            <div className="fixed inset-0 z-overlay overflow-y-auto overscroll-contain bg-canvas">
              {detail ? (
                editorPane
              ) : (
                <div className="px-4 pt-[max(4px,env(safe-area-inset-top))]">
                  {back}
                  {editorPane}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-[17rem_minmax(0,1fr)] gap-8 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-12">
          <aside className="sticky top-24 flex max-h-[calc(100dvh-8rem)] flex-col gap-3 self-start overflow-y-auto overscroll-contain pr-1">
            {side}
          </aside>
          <div className="min-w-0 max-w-3xl">{editorPane}</div>
        </div>
      )}
      {undoBar}
      {confirmDialog}
      <NoteMapImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        existing={null}
        onImport={importNew}
      />
      <FolderDialog
        state={folderDialog}
        folders={folderList}
        onClose={() => setFolderDialog(null)}
        onCreated={(id) => changeScope({ kind: "folder", id })}
      />
      <ShareDialog
        target={
          shareTarget && shareTarget.item.kind === "note" && detail && shareTarget.item.id === detail.id
            ? {
                ...shareTarget,
                inFolder: detail.folder_id ? { private: detail.folder_private ?? false } : null,
              }
            : shareTarget
        }
        onClose={() => setShareTarget(null)}
      />
      {detail && (
        <VersionsDialog
          noteId={detail.id}
          open={versionsOpen}
          canRestore={writable}
          onClose={() => setVersionsOpen(false)}
          onRestore={restoreVersion}
        />
      )}
      <ConfirmDialog
        open={!!folderToDelete}
        onOpenChange={(open) => {
          if (!open) setFolderToDelete(null);
        }}
        title={t("folders.deleteTitle", { name: folderToDelete?.name ?? "" })}
        description={t("folders.deleteText", {
          count: folderToDelete ? (folderCounts(notes.data ?? [], folderList).get(folderToDelete.id) ?? 0) : 0,
        })}
        confirmLabel={t("folders.deleteConfirm")}
        cancelLabel={t("folders.cancel")}
        closeLabel={t("folders.cancel")}
        pending={deleteFolder.isPending}
        onConfirm={() => {
          if (!folderToDelete) return;
          const target = folderToDelete;
          deleteFolder.mutate(
            { id: target.id, notes: folderCounts(notes.data ?? [], folderList).get(target.id) ?? 0 },
            {
              onSuccess: () => {
                setFolderToDelete(null);
                if (scope.kind === "folder" && (scope.id === target.id || target.id === folderList.find((f) => f.id === scope.id)?.parentId)) {
                  changeScope({ kind: "mine" });
                }
              },
            },
          );
        }}
      />
      <ConfirmDialog
        open={!!dismissing}
        onOpenChange={(open) => {
          if (!open) setDismissing(null);
        }}
        title={t("sharing.dismissTitle", { title: dismissing?.title || t("untitled") })}
        description={t("sharing.dismissText")}
        confirmLabel={t("sharing.dismiss")}
        cancelLabel={t("deleteConfirm.cancel")}
        closeLabel={t("deleteConfirm.cancel")}
        onConfirm={() => {
          if (!dismissing) return;
          const id = dismissing.id;
          setDismissing(null);
          dismissNote.mutate(id);
          if (id === selectedId) {
            if (isPhone) closeOnPhone();
            else select(null);
          }
        }}
      />
    </div>
  );
}
