"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useProfile, useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { industryKeyOf, type IndustryKey } from "@/features/onboarding/industries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import { draftFromDoc } from "./document";
import { getNoteSaver, useCreateNote } from "./queries";
import { isNoteTemplateKey, workNoteDoc, type NoteTemplateKey } from "./templates";

/**
 * Notes tied to tasks, milestones and deals (note_links). Notes are private,
 * so a link joins two rows of the same account: only an owner's own tasks,
 * milestones and deals can have notes; a worker never sees this.
 */

/** A note belongs to one of these; a task knows its milestone for the way back. */
export type WorkTarget =
  | { kind: "task"; id: string; milestoneId: string }
  | { kind: "milestone"; id: string }
  | { kind: "deal"; id: string };

const TARGET_COLUMN = { task: "task_id", milestone: "milestone_id", deal: "deal_id" } as const;

export type LinkedNote = {
  linkId: string;
  id: string;
  title: string;
  preview: string | null;
  updated_at: string;
};

export type NoteBacklink = {
  linkId: string;
  kind: WorkTarget["kind"];
  title: string;
  /** Where the link leads: the milestone (of the task) or the deal. */
  href: string;
};

/** A task or milestone has a handful of notes, a note a handful of links. */
const LINK_LIMIT = 50;

export const noteLinkKeys = {
  all: (userId: string) => ["note-links", userId] as const,
  target: (userId: string, kind: WorkTarget["kind"], id: string) =>
    ["note-links", userId, kind, id] as const,
  note: (userId: string, noteId: string) => ["note-links", userId, "note", noteId] as const,
  templates: (userId: string, milestoneId: string) =>
    ["note-links", userId, "templates", milestoneId] as const,
};

/** Notes in the account's own space: an owner's, never a worker's view of the owner. */
export function useNotesInWork(): { allowed: boolean; readOnly: boolean } {
  const workspace = useWorkspace();
  return { allowed: workspace.role === "owner", readOnly: workspace.readOnly };
}

/** The notes of a task or milestone, newest link first; deleted notes are left out. */
export function useLinkedNotes(target: WorkTarget, enabled = true) {
  const { user } = useSession();
  return useQuery({
    queryKey: noteLinkKeys.target(user.id, target.kind, target.id),
    queryFn: async (): Promise<LinkedNote[]> => {
      const column = TARGET_COLUMN[target.kind];
      const { data, error } = await createClient()
        .from("note_links")
        .select("id, note:notes(id, title, preview, updated_at, deleted_at)")
        .eq("user_id", user.id)
        .eq(column, target.id)
        .order("created_at", { ascending: false })
        .limit(LINK_LIMIT);
      if (error) throw error;
      return data.flatMap(({ id, note }) =>
        note && !note.deleted_at
          ? [
              {
                linkId: id,
                id: note.id,
                title: note.title,
                preview: note.preview,
                updated_at: note.updated_at,
              },
            ]
          : [],
      );
    },
    enabled,
  });
}

/** What a note belongs to, for the quiet "Belongs to" line above its text. */
export function useNoteBacklinks(noteId: string) {
  const { user } = useSession();
  return useQuery({
    queryKey: noteLinkKeys.note(user.id, noteId),
    queryFn: async (): Promise<NoteBacklink[]> => {
      const { data, error } = await createClient()
        .from("note_links")
        .select(
          "id, task:tasks(id, title, milestone_id), milestone:milestones(id, title), deal:deals(id, title)",
        )
        .eq("user_id", user.id)
        .eq("note_id", noteId)
        .order("created_at")
        .limit(LINK_LIMIT);
      if (error) throw error;
      return data.flatMap(({ id, task, milestone, deal }): NoteBacklink[] => {
        if (task) {
          return [
            {
              linkId: id,
              kind: "task",
              title: task.title,
              href: `/app/milniky/${task.milestone_id}`,
            },
          ];
        }
        if (milestone) {
          return [
            {
              linkId: id,
              kind: "milestone",
              title: milestone.title,
              href: `/app/milniky/${milestone.id}`,
            },
          ];
        }
        if (deal) {
          return [
            { linkId: id, kind: "deal", title: deal.title, href: `/app/pipeline?deal=${deal.id}` },
          ];
        }
        return [];
      });
    },
  });
}

/**
 * Which tasks of a milestone are path steps whose result is a text, with the
 * key of their outline (path_tasks.note_template through tasks.template_id).
 */
export function useTaskNoteTemplates(milestoneId: string, enabled = true) {
  const { user } = useSession();
  const workspace = useWorkspace();
  return useQuery({
    queryKey: noteLinkKeys.templates(user.id, milestoneId),
    queryFn: async (): Promise<Record<string, NoteTemplateKey>> => {
      const { data, error } = await createClient()
        .from("tasks")
        .select("id, template:path_tasks(note_template)")
        .eq("user_id", workspace.id)
        .eq("milestone_id", milestoneId)
        .not("template_id", "is", null)
        .limit(500);
      if (error) throw error;
      const out: Record<string, NoteTemplateKey> = {};
      for (const row of data) {
        const key = row.template?.note_template;
        if (isNoteTemplateKey(key)) out[row.id] = key;
      }
      return out;
    },
    enabled,
    // Templates never change under a running app.
    staleTime: Infinity,
  });
}

function insertLink(noteId: string, target: WorkTarget) {
  return createClient()
    .from("note_links")
    .insert({
      note_id: noteId,
      task_id: target.kind === "task" ? target.id : null,
      milestone_id: target.kind === "milestone" ? target.id : null,
      deal_id: target.kind === "deal" ? target.id : null,
    });
}

/** Ties an existing note to a task or milestone; linking it twice is no error. */
export function useLinkNote() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, target }: { noteId: string; target: WorkTarget }) => {
      const { error } = await insertLink(noteId, target);
      if (error && error.code !== "23505") throw error;
    },
    onSuccess: (_data, { target }) => {
      track("note_linked", { target: target.kind, how: "attach" });
      void queryClient.invalidateQueries({ queryKey: noteLinkKeys.all(user.id) });
    },
  });
}

export function useUnlinkNote() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ linkId }: { linkId: string; kind: WorkTarget["kind"] }) => {
      const { error } = await createClient()
        .from("note_links")
        .delete()
        .eq("user_id", user.id)
        .eq("id", linkId);
      if (error) throw error;
    },
    onSuccess: (_data, { kind }) => {
      track("note_unlinked", { target: kind });
      void queryClient.invalidateQueries({ queryKey: noteLinkKeys.all(user.id) });
    },
  });
}

/**
 * "Write in notes": a new note named after the task or milestone (with the
 * step's outline when it has one), saved, tied to it, and its id returned so
 * the caller can open it.
 */
export function useWriteToNotes() {
  const { user } = useSession();
  const profile = useProfile();
  const t = useTranslations("notes");
  const queryClient = useQueryClient();
  const createNote = useCreateNote();
  const industry: IndustryKey | null = profile.industry ? industryKeyOf(profile.industry) : null;

  return useMutation({
    mutationFn: async ({
      target,
      title,
      template,
    }: {
      target: WorkTarget;
      title: string;
      template: NoteTemplateKey | null;
    }): Promise<string> => {
      const draft = draftFromDoc(
        workNoteDoc(title, template, industry, (key) =>
          t(`templates.${key}` as "templates.pricing.title"),
        ),
      );
      const id = createNote({
        draft,
        where: target.kind,
        template: template
          ? { key: template, industry: industry === "other" ? null : industry }
          : undefined,
      });
      // The link needs the note in the database first.
      const saver = getNoteSaver(user.id);
      await saver.flush(id);
      if (saver.unsavedDraft(id)) throw new Error("note_not_saved");
      const { error } = await insertLink(id, target);
      if (error) throw error;
      return id;
    },
    onSuccess: (_id, { target, template }) => {
      track("note_linked", {
        target: target.kind,
        how: "write",
        template: template ?? undefined,
      });
      void queryClient.invalidateQueries({ queryKey: noteLinkKeys.all(user.id) });
    },
  });
}
