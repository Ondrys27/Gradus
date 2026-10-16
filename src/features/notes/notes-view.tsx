"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, PinIcon, PinOffIcon, SquarePenIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile, useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { industryKeyOf, type IndustryKey } from "@/features/onboarding/industries";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { draftFromDoc, EMPTY_DOC, isBlank } from "./document";
import { NotesEmpty } from "./notes-empty";
import { NotesList } from "./notes-list";
import { neighbourAfterRemoval, orderBySearch } from "./notes-logic";
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
  type NoteDetail,
} from "./queries";
import { templateDraft, type NoteTemplateKey } from "./templates";

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

/** ⌘N / Ctrl+N where the browser lets the page have it, ⌥N / Alt+N everywhere. */
export function isNewNoteShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): boolean {
  if (event.shiftKey) return false;
  const plain = event.key.toLowerCase() === "n" || event.code === "KeyN";
  if ((event.metaKey || event.ctrlKey) && !event.altKey) return plain;
  return event.altKey && !event.metaKey && !event.ctrlKey && event.code === "KeyN";
}

export function NotesView() {
  const t = useTranslations("notes");
  const router = useRouter();
  const pathname = usePathname();
  const selectedId = useSearchParams().get("note");
  const isPhone = useIsPhone();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const { readOnly } = useWorkspace();
  const profile = useProfile();
  const saver = useNoteSaver();

  const notes = useNotes();
  useRestoreUnsavedNotes(notes.data);
  const note = useNote(selectedId);

  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 250);
  const search = useNoteSearch(debounced);
  const [trashOpen, setTrashOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string } | null>(null);
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
    return orderBySearch(
      notes.data,
      (search.data ?? []).map((hit) => hit.id),
    );
  }, [debounced, notes.data, search.data]);

  const select = useCallback(
    (id: string | null) => {
      const url = id ? `${pathname}?note=${encodeURIComponent(id)}` : pathname;
      if (isPhone && id && !selectedId) {
        pushedRef.current = true;
        router.push(url, { scroll: false });
      } else {
        router.replace(url, { scroll: false });
      }
    },
    [isPhone, pathname, router, selectedId],
  );

  const closeOnPhone = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false;
      router.back();
    } else {
      router.replace(pathname, { scroll: false });
    }
  }, [pathname, router]);

  // A computer always shows a note next to the list: the newest one by default,
  // and another one when the address points at a note that is gone.
  const listed = notes.data;
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

  const newNote = useCallback(
    (where: "list" | "empty_state" | "shortcut", template?: NoteTemplateKey) => {
      if (readOnly) return;
      const draft = template
        ? templateDraft(template, industry, (key) => t(`templates.${key}` as "templates.pricing.title"))
        : draftFromDoc(EMPTY_DOC);
      const id = createNote({
        draft,
        where,
        template: template ? { key: template, industry: industry === "other" ? null : industry } : undefined,
      });
      setJustCreated(id);
      setTrashOpen(false);
      setQuery("");
      select(id);
    },
    [createNote, industry, readOnly, select, t],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isNewNoteShortcut(event) || readOnly) return;
      // Not over a dialog, the search window or the onboarding.
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      event.preventDefault();
      newNote("shortcut");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newNote, readOnly]);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  function remove(target: NoteDetail) {
    const visible = results ?? listed ?? [];
    const next = neighbourAfterRemoval(visible, target.id);
    deleteNote.mutate({ id: target.id, pinned: target.pinned });
    setUndo({ id: target.id });
    if (isPhone) closeOnPhone();
    else select(next && next.id !== target.id ? next.id : null);
  }

  function undoRemove() {
    if (!undo) return;
    const id = undo.id;
    setUndo(null);
    restoreNote.mutate(id, { onSuccess: () => select(id) });
  }

  const empty = !!listed && listed.length === 0 && !query;
  const detail = selectedId ? note.data : null;

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

  const actions =
    detail && !readOnly ? (
      <>
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
          onClick={() => remove(detail)}
        >
          <Trash2Icon />
        </Button>
      </>
    ) : null;

  const editorPane = detail ? (
    <NoteEditor
      key={detail.id}
      note={detail}
      readOnly={readOnly}
      autoFocus={detail.id === justCreated}
      isPhone={isPhone}
      actions={actions}
      back={back}
    />
  ) : selectedId && note.isPending ? (
    <EditorSkeleton />
  ) : (
    <p className="pt-24 text-center text-sm text-ink-muted">{t("selectNote")}</p>
  );

  const undoBar = undo && (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-xl bg-surface/80 px-3 py-2 text-sm text-ink-soft"
    >
      {t("deleted")}
      <button type="button" onClick={undoRemove} className="min-h-11 font-semibold text-violet mouse:min-h-8">
        {t("undo")}
      </button>
    </div>
  );

  const side = trashOpen ? (
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
      onOpenTrash={() => setTrashOpen(true)}
      loadError={notes.isError && !listed}
      onRetry={() => void notes.refetch()}
    />
  );

  const newButton = !readOnly && (
    <Button onClick={() => newNote("list")} title={t("newHint")} data-testid="note-new">
      <SquarePenIcon />
      {t("new")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} actions={newButton} />
      {readOnly && <p className="text-sm text-orange">{t("readOnly")}</p>}

      {empty && !trashOpen ? (
        <NotesEmpty
          readOnly={readOnly}
          onTemplate={(key) => newNote("empty_state", key)}
          onBlank={() => newNote("empty_state")}
          onOpenTrash={() => setTrashOpen(true)}
        />
      ) : isPhone ? (
        <>
          {undoBar}
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
            {undoBar}
            {side}
          </aside>
          <div className="min-w-0 max-w-3xl">{editorPane}</div>
        </div>
      )}
    </div>
  );
}
