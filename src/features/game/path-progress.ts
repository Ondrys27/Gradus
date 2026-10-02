import type { LocalizedText } from "./types";

/**
 * A path's steps next to the user's own copies of them, for the path map in
 * Milestones and the level window. A step counts by its key, so a step copied
 * from an earlier path still counts after the path changed.
 */

export type TemplateStep = {
  id: string;
  key: string;
  pathKey: string;
  chapter: number;
  position: number;
  title: LocalizedText;
  xp: number;
  unlockKey: string | null;
};

/** One of the user's milestones that came from a template. */
export type OwnedStep = {
  id: string;
  templateId: string;
  title: string;
  completed: boolean;
};

export type StepState = "done" | "current" | "upcoming" | "removed";

export type StepProgress = TemplateStep & {
  state: StepState;
  /** The user's milestone for this step; null when they deleted it. */
  milestoneId: string | null;
  /** The user's own title (they may have renamed it); null when deleted. */
  ownTitle: string | null;
  /** The template the user's copy came from (maybe of an earlier path). */
  ownTemplateId: string | null;
};

export type ChapterProgress = {
  chapter: number;
  steps: StepProgress[];
  done: number;
  total: number;
};

export type PathProgress = {
  chapters: ChapterProgress[];
  current: StepProgress | null;
  done: number;
  total: number;
};

export function buildPathProgress(
  pathKey: string | null,
  templates: readonly TemplateStep[],
  owned: readonly OwnedStep[],
): PathProgress {
  const keyById = new Map(templates.map((t) => [t.id, t.key]));
  // Several copies of one step (unlikely) count as done when any is done.
  const byKey = new Map<string, OwnedStep>();
  for (const row of owned) {
    const key = keyById.get(row.templateId);
    if (!key) continue;
    const have = byKey.get(key);
    if (!have || (!have.completed && row.completed)) byKey.set(key, row);
  }

  const steps = templates
    .filter((t) => t.pathKey === pathKey)
    .sort((a, b) => a.chapter - b.chapter || a.position - b.position);

  let current: StepProgress | null = null;
  const withState: StepProgress[] = steps.map((step) => {
    const mine = byKey.get(step.key);
    let state: StepState;
    if (!mine) state = "removed";
    else if (mine.completed) state = "done";
    else if (!current) state = "current";
    else state = "upcoming";
    const progress: StepProgress = {
      ...step,
      state,
      milestoneId: mine?.id ?? null,
      ownTitle: mine?.title ?? null,
      ownTemplateId: mine?.templateId ?? null,
    };
    if (state === "current") current = progress;
    return progress;
  });

  const chapterNumbers = [...new Set(withState.map((s) => s.chapter))].sort((a, b) => a - b);
  const chapters = chapterNumbers.map((chapter) => {
    const inChapter = withState.filter((s) => s.chapter === chapter);
    return {
      chapter,
      steps: inChapter,
      done: inChapter.filter((s) => s.state === "done").length,
      total: inChapter.length,
    };
  });

  return {
    chapters,
    current,
    done: withState.filter((s) => s.state === "done").length,
    total: withState.length,
  };
}
