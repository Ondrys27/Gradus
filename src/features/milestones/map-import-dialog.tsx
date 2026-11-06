"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CircleIcon, FileUpIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { track } from "@/lib/analytics/client";
import { downloadBlob } from "@/lib/download";
import {
  MINDMAP_ACCEPT,
  MINDMAP_FILE_MAX_BYTES,
  toMarkdown,
  type MindMapFormat,
  type MindMapParseFailure,
  type MindMapTree,
} from "@/lib/mindmap/formats";
import { cn } from "@/lib/utils";
import {
  consistentTree,
  IMPORT_MAX_TASKS,
  importBlock,
  importItems,
  importSummary,
  mapFileName,
  MILESTONE_TASK_LIMIT,
  prepareImport,
  tasksToMindMap,
} from "./map-io";
import { parseMindMapUpload, useCreateMilestoneFromImport, useImportTasks } from "./queries";
import { TITLE_MAX } from "./schemas";
import { MAX_TASK_LEVELS } from "./task-tree";
import type { Milestone, Task } from "./types";
import { useFreshOnOpen } from "./use-fresh-on-open";

/** Into this milestone, or a new milestone made from the file. */
export type ImportTarget =
  { kind: "milestone"; milestone: Milestone; tasks: Task[] } | { kind: "new" };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ImportTarget;
  /** A file dropped onto the map: read straight away. */
  initialFile?: File | null;
  /** After an import into the milestone (the dialog is closed by then). */
  onImported?: () => void;
};

/** "Import map": pick or drop a file, see the tree, choose how, import. */
export function MapImportDialog({ open, onOpenChange, target, initialFile, onImported }: Props) {
  const t = useTranslations("milestones.mapIo");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={target.kind === "new" ? t("importNewTitle") : t("importTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,560px)]"
    >
      <ImportBody
        key={generation}
        target={target}
        initialFile={initialFile ?? null}
        onClose={() => onOpenChange(false)}
        onImported={onImported}
      />
    </ResponsiveDialog>
  );
}

type Parsed = { fileName: string; format: MindMapFormat; tree: MindMapTree };
type ErrorKey =
  MindMapParseFailure | "tooMany" | "milestoneFull" | "readOnly" | "saveFailed" | "network";

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
const baseName = (name: string) => name.replace(/\.[^.]+$/, "");

function ImportBody({
  target,
  initialFile,
  onClose,
  onImported,
}: {
  target: ImportTarget;
  initialFile: File | null;
  onClose: () => void;
  onImported?: () => void;
}) {
  const t = useTranslations("milestones.mapIo");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [over, setOver] = useState(false);
  const [replace, setReplace] = useState(false);
  const [flattenLevel, setFlattenLevel] = useState(MAX_TASK_LEVELS);
  const [title, setTitle] = useState("");
  const milestoneId = target.kind === "milestone" ? target.milestone.id : "";
  const importTasks = useImportTasks(milestoneId);
  const createFromImport = useCreateMilestoneFromImport();
  const saving = importTasks.isPending || createFromImport.isPending;

  async function read(file: File) {
    setError(null);
    if (file.size > MINDMAP_FILE_MAX_BYTES) {
      setError("tooLarge");
      return;
    }
    setReading(true);
    try {
      const result = await parseMindMapUpload(file);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setParsed({ fileName: file.name, format: result.format, tree: result.tree });
      setTitle((result.tree.title || baseName(file.name)).slice(0, TITLE_MAX));
    } catch {
      setError("network");
    } finally {
      setReading(false);
    }
  }

  // A file dropped onto the map is read as soon as the dialog opens.
  const started = useRef(false);
  useEffect(() => {
    if (!initialFile || started.current) return;
    started.current = true;
    void read(initialFile);
  }, [initialFile]);

  const items = useMemo(() => (parsed ? importItems(parsed.tree) : null), [parsed]);
  const summary = useMemo(() => (items ? importSummary(items) : null), [items]);
  const flatten = summary?.tooDeep ? flattenLevel : null;
  const prepared = useMemo(() => (items ? prepareImport(items, flatten) : null), [items, flatten]);
  const existing = target.kind === "milestone" ? target.tasks.length : 0;
  const replacing = replace && existing > 0;
  const block =
    summary && importBlock(summary, { existing, replace: replacing, flattened: flatten !== null });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsed || !prepared || !summary || block) return;
    setError(null);
    try {
      if (target.kind === "new") {
        const name =
          title.trim().slice(0, TITLE_MAX) || baseName(parsed.fileName) || t("fileFallback");
        const milestone = await createFromImport.mutateAsync({
          title: name,
          items: prepared,
          format: parsed.format,
          flattened: flatten !== null,
        });
        onClose();
        router.push(`/app/milniky/${milestone.id}?imported=1`);
        return;
      }
      if (replacing) {
        // The tasks that are about to go are saved first, as Markdown.
        const markdown = toMarkdown(tasksToMindMap(target.milestone, target.tasks));
        downloadBlob(
          new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
          mapFileName(`${target.milestone.title} ${t("backupSuffix")}`, "md", t("fileFallback")),
        );
        track("mindmap_exported", { format: "markdown", from: "backup" });
      }
      await importTasks.mutateAsync({
        items: prepared,
        format: parsed.format,
        replace: replacing,
        flattened: flatten !== null,
      });
      onClose();
      onImported?.();
    } catch (cause) {
      const message = String((cause as { message?: string })?.message ?? "");
      setError(message.includes("read_only") ? "readOnly" : "saveFailed");
    }
  }

  const errorText = (key: ErrorKey) =>
    key === "tooMany"
      ? t("errors.tooMany", { max: IMPORT_MAX_TASKS })
      : key === "milestoneFull"
        ? t("errors.milestoneFull", { max: MILESTONE_TASK_LIMIT })
        : t(`errors.${key}`);

  if (!parsed || !prepared || !summary) {
    return (
      <div className="flex flex-col gap-4">
        <div
          onDragEnter={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            setOver(true);
          }}
          onDragOver={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            setOver(false);
            const file = event.dataTransfer.files[0];
            if (file) void read(file);
          }}
          className={cn(
            "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-colors",
            over ? "border-violet bg-violet/10" : "border-line-strong",
          )}
        >
          {reading ? (
            <Loader2Icon
              aria-hidden
              className="size-6 animate-spin text-violet motion-reduce:animate-none"
            />
          ) : (
            <FileUpIcon aria-hidden className="size-6 text-violet" />
          )}
          <p className="max-w-sm text-sm text-ink-soft">{reading ? t("reading") : t("pickHint")}</p>
          <input
            ref={inputRef}
            type="file"
            accept={MINDMAP_ACCEPT}
            aria-label={t("fileLabel")}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void read(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={reading}
            onClick={() => inputRef.current?.click()}
          >
            {t("pick")}
          </Button>
        </div>
        {error && <FormAlert>{errorText(error)}</FormAlert>}
        <ImportHelp />
      </div>
    );
  }

  const rootTitle = target.kind === "milestone" ? target.milestone.title : title;
  const submitLabel =
    target.kind === "new"
      ? t("submitNew")
      : replacing
        ? t("submitReplace")
        : t("submit", { count: summary.tasks });

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {target.kind === "new" && (
        <FormField id="mindmap-title" label={t("titleLabel")}>
          <Input
            value={title}
            maxLength={TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            {...fieldA11y("mindmap-title")}
          />
        </FormField>
      )}

      <section aria-label={t("preview")} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="micro-label">{t("preview")}</h3>
          <p data-testid="mindmap-summary" className="text-sm text-ink-soft tabular-nums">
            {t("summary", { tasks: summary.tasks, depth: summary.depth })}
            {summary.done > 0 && ` · ${t("summaryDone", { count: summary.done })}`}
            {` · ${t(`format.${parsed.format}`)}`}
          </p>
        </div>
        <TreePreview root={rootTitle} items={prepared} />
        {target.kind === "milestone" && parsed.tree.title && parsed.tree.children.length > 0 && (
          <p className="text-xs text-ink-muted">
            {t("rootIsMilestone", { title: parsed.tree.title })}
          </p>
        )}
      </section>

      {summary.tooDeep && (
        <div className="flex flex-col gap-2 rounded-xl border border-orange/40 bg-orange/10 p-3">
          <p className="text-sm text-ink">
            {t("tooDeep", { depth: summary.depth, max: MAX_TASK_LEVELS })}
          </p>
          <FormField id="mindmap-flatten" label={t("flattenLabel")} hint={t("flattenHint")}>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_TASK_LEVELS}
              value={flattenLevel}
              onChange={(event) => {
                const value = Math.trunc(Number(event.target.value));
                setFlattenLevel(
                  Math.min(Math.max(Number.isFinite(value) ? value : 1, 1), MAX_TASK_LEVELS),
                );
              }}
              {...fieldA11y("mindmap-flatten", undefined, true)}
            />
          </FormField>
        </div>
      )}

      {target.kind === "milestone" && existing > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink">{t("mode.label")}</legend>
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {(["append", "replace"] as const).map((mode) => {
              const checked = (mode === "replace") === replace;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setReplace(mode === "replace")}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
                    checked
                      ? "border-violet/60 bg-violet/15 text-ink"
                      : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
                  )}
                >
                  {t(`mode.${mode}`)}
                </button>
              );
            })}
          </div>
          {replace && (
            <p className="text-sm text-orange">{t("replaceWarning", { count: existing })}</p>
          )}
        </fieldset>
      )}

      {error ? (
        <FormAlert>{errorText(error)}</FormAlert>
      ) : (
        block && block !== "tooDeep" && <FormAlert>{errorText(block)}</FormAlert>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={() => {
            setParsed(null);
            setError(null);
          }}
        >
          {t("otherFile")}
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            variant={replacing ? "destructive" : "default"}
            disabled={saving || Boolean(block)}
          >
            {saving ? t("importing") : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** The first lines of the tree as it will be imported, indented. */
const PREVIEW_LINES = 60;

function TreePreview({ root, items }: { root: string; items: MindMapTree }) {
  const t = useTranslations("milestones.mapIo");
  const lines: { title: string; depth: number; done: boolean }[] = [];
  let total = 0;
  // A done parent with open subtasks is imported open; the preview says the same.
  const walk = (list: MindMapTree[], depth: number) => {
    for (const item of list) {
      total += 1;
      if (lines.length < PREVIEW_LINES) {
        lines.push({ title: item.title, depth, done: item.done === true });
      }
      walk(item.children, depth + 1);
    }
  };
  walk(consistentTree(items).children, 1);

  return (
    <div className="max-h-64 overflow-y-auto rounded-xl border border-line bg-canvas-deep/40 p-3">
      <ul data-testid="mindmap-preview" className="flex flex-col gap-1 text-sm">
        <li className="font-semibold text-ink [overflow-wrap:anywhere]">{root}</li>
        {lines.map((line, index) => (
          <li
            key={index}
            className="flex items-start gap-2 text-ink-soft"
            style={{ paddingLeft: `${Math.min(line.depth, 12) * 14}px` }}
          >
            {line.done ? (
              <CheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-teal" />
            ) : (
              <CircleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-muted" />
            )}
            <span
              className={cn(
                "min-w-0 [overflow-wrap:anywhere]",
                line.done && "text-ink-muted line-through",
              )}
            >
              {line.title}
            </span>
          </li>
        ))}
        {total > lines.length && (
          <li className="text-ink-muted">{t("more", { count: total - lines.length })}</li>
        )}
      </ul>
    </div>
  );
}

/** How to get a map out of other apps, MindNode first. */
export function ImportHelp() {
  const t = useTranslations("milestones.mapIo.help");
  return (
    <details className="group rounded-xl border border-line px-3.5 py-3 text-sm">
      <summary className="cursor-pointer font-medium text-ink outline-none focus-visible:ring-3 focus-visible:ring-violet/40">
        {t("title")}
      </summary>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-ink-soft">
        <li>{t("mindnode")}</li>
        <li>{t("xmind")}</li>
        <li>{t("freemind")}</li>
        <li>{t("outliner")}</li>
        <li>{t("text")}</li>
      </ul>
    </details>
  );
}
