"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { FileUpIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { ImportHelp } from "@/features/milestones/map-import-dialog";
import { parseMindMapUpload } from "@/features/milestones/queries";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import {
  countNodes,
  MINDMAP_ACCEPT,
  MINDMAP_FILE_MAX_BYTES,
  treeDepth,
  type MindMapFormat,
  type MindMapParseFailure,
  type MindMapTree,
} from "@/lib/mindmap/formats";
import { cn } from "@/lib/utils";
import { MAP_LIMITS } from "./map-doc";

export type NoteImportMode = "append" | "replace" | "new";

export type NoteImport = {
  fileName: string;
  format: MindMapFormat;
  tree: MindMapTree;
  mode: NoteImportMode;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Into the open map (how many nodes it has now), or a new note from the file. */
  existing: number | null;
  initialFile?: File | null;
  onImport: (result: NoteImport) => void;
};

type ErrorKey = MindMapParseFailure | "network" | "tooMany";

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

/** "Import map" of a note: pick or drop a file, see what is in it, add it or replace the map. */
export function NoteMapImportDialog({ open, onOpenChange, existing, initialFile, onImport }: Props) {
  const t = useTranslations("notes.map.import");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing === null ? t("titleNew") : t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,520px)]"
    >
      <ImportBody
        key={generation}
        existing={existing}
        initialFile={initialFile ?? null}
        onCancel={() => onOpenChange(false)}
        onImport={(result) => {
          onImport(result);
          onOpenChange(false);
        }}
      />
    </ResponsiveDialog>
  );
}

const PREVIEW_LINES = 40;

function ImportBody({
  existing,
  initialFile,
  onCancel,
  onImport,
}: {
  existing: number | null;
  initialFile: File | null;
  onCancel: () => void;
  onImport: (result: NoteImport) => void;
}) {
  const t = useTranslations("notes.map.import");
  const tio = useTranslations("milestones.mapIo");
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [parsed, setParsed] = useState<Omit<NoteImport, "mode"> | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [over, setOver] = useState(false);
  const [replace, setReplace] = useState(false);

  async function read(file: File) {
    setError(null);
    if (file.size > MINDMAP_FILE_MAX_BYTES) {
      setError("tooLarge");
      return;
    }
    setReading(true);
    try {
      const result = await parseMindMapUpload(file);
      if (!result.ok) setError(result.error);
      else setParsed({ fileName: file.name, format: result.format, tree: result.tree });
    } catch {
      setError("network");
    } finally {
      setReading(false);
    }
  }

  const started = useRef(false);
  useEffect(() => {
    if (!initialFile || started.current) return;
    started.current = true;
    void read(initialFile);
  }, [initialFile]);

  const nodes = parsed ? countNodes(parsed.tree) : 0;
  const depth = parsed ? treeDepth(parsed.tree) : 0;
  const lines = useMemo(() => {
    const out: { title: string; depth: number }[] = [];
    const walk = (list: MindMapTree[], level: number) => {
      for (const item of list) {
        if (out.length >= PREVIEW_LINES) return;
        out.push({ title: item.title, depth: level });
        walk(item.children, level + 1);
      }
    };
    if (parsed) walk(parsed.tree.children, 1);
    return out;
  }, [parsed]);

  const keeps = existing !== null && !replace ? existing : 0;
  const tooMany = nodes + keeps > MAP_LIMITS.nodes;
  const mode: NoteImportMode = existing === null ? "new" : replace ? "replace" : "append";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsed || tooMany) return;
    onImport({ ...parsed, mode });
  }

  const errorText = (key: ErrorKey) =>
    key === "tooMany" ? t("tooMany", { max: MAP_LIMITS.nodes }) : tio(`errors.${key}`);

  if (!parsed) {
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
            <Loader2Icon aria-hidden className="size-6 animate-spin text-violet motion-reduce:animate-none" />
          ) : (
            <FileUpIcon aria-hidden className="size-6 text-violet" />
          )}
          <p className="max-w-sm text-sm text-ink-soft">{reading ? tio("reading") : tio("pickHint")}</p>
          <input
            ref={inputRef}
            type="file"
            accept={MINDMAP_ACCEPT}
            aria-label={tio("fileLabel")}
            data-testid="note-map-import-file"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void read(file);
            }}
          />
          <Button type="button" variant="outline" disabled={reading} onClick={() => inputRef.current?.click()}>
            {tio("pick")}
          </Button>
        </div>
        {error && <FormAlert>{errorText(error)}</FormAlert>}
        <ImportHelp />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <section aria-label={tio("preview")} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="micro-label">{tio("preview")}</h3>
          <p data-testid="note-map-import-summary" className="text-sm text-ink-soft tabular-nums">
            {t("summary", { nodes, depth })}
            {` · ${tio(`format.${parsed.format}`)}`}
          </p>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-line bg-canvas-deep/40 p-3">
          <ul className="flex flex-col gap-1 text-sm">
            {parsed.tree.title && (
              <li className="font-semibold text-ink [overflow-wrap:anywhere]">{parsed.tree.title}</li>
            )}
            {lines.map((line, index) => (
              <li
                key={index}
                className="text-ink-soft [overflow-wrap:anywhere]"
                style={{ paddingLeft: `${Math.min(line.depth, 12) * 14}px` }}
              >
                {line.title}
              </li>
            ))}
            {nodes > lines.length && (
              <li className="text-ink-muted">{tio("more", { count: nodes - lines.length })}</li>
            )}
          </ul>
        </div>
        {depth > MAP_LIMITS.depth && (
          <p className="text-xs text-ink-muted">{t("flattened", { max: MAP_LIMITS.depth })}</p>
        )}
      </section>

      {existing !== null && existing > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink">{t("modeLabel")}</legend>
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {(["append", "replace"] as const).map((value) => {
              const checked = (value === "replace") === replace;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setReplace(value === "replace")}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
                    checked
                      ? "border-violet/60 bg-violet/15 text-ink"
                      : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
                  )}
                >
                  {t(`mode.${value}`)}
                </button>
              );
            })}
          </div>
          {replace && <p className="text-sm text-orange">{t("replaceWarning")}</p>}
        </fieldset>
      )}

      {tooMany && <FormAlert>{errorText("tooMany")}</FormAlert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => setParsed(null)}>
          {tio("otherFile")}
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            variant={replace ? "destructive" : "default"}
            disabled={tooMany}
            data-testid="note-map-import-submit"
          >
            {mode === "new" ? t("submitNew") : replace ? t("submitReplace") : t("submit", { count: nodes })}
          </Button>
        </div>
      </div>
    </form>
  );
}
