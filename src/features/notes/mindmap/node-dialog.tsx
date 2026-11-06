"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CheckIcon, Link2Icon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { KIND_ICONS } from "@/features/search/use-search-rows";
import { track } from "@/lib/analytics/client";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { useMentionSearch } from "../mention-queries";
import { groupByKind, type MentionTarget } from "../mentions";
import {
  BRANCH_COLORS,
  cleanNodeTitle,
  MAP_LIMITS,
  normalizeUrl,
  type BranchColor,
  type MapLink,
  type MapNode,
} from "./map-doc";
import { COLOR_FILL } from "./map-node";
import type { NodePatch } from "./map-ops";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: MapNode | null;
  root: boolean;
  /** The colour it is drawn in now (its own or inherited). */
  shownColor: BranchColor | null;
  target?: MentionTarget;
  onSave: (patch: NodePatch) => void;
};

/**
 * A node's details: its text, a small note under it, one link (a web address
 * or a contact, deal, event or worker) and its branch colour. On a phone it
 * is the bottom panel every node is edited in.
 */
export function NodeDialog({ open, onOpenChange, node, root, shownColor, target, onSave }: Props) {
  const t = useTranslations("notes.map.details");
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,480px)]"
    >
      {node && (
        <NodeForm
          key={node.id}
          node={node}
          root={root}
          shownColor={shownColor}
          target={target}
          onCancel={() => onOpenChange(false)}
          onSave={(patch) => {
            onSave(patch);
            onOpenChange(false);
          }}
        />
      )}
    </ResponsiveDialog>
  );
}

type LinkMode = "none" | "url" | "record";

function NodeForm({
  node,
  root,
  shownColor,
  target,
  onCancel,
  onSave,
}: {
  node: MapNode;
  root: boolean;
  shownColor: BranchColor | null;
  target?: MentionTarget;
  onCancel: () => void;
  onSave: (patch: NodePatch) => void;
}) {
  const t = useTranslations("notes.map.details");
  const tKind = useTranslations("search.groups");
  const [title, setTitle] = useState(node.title);
  const [note, setNote] = useState(node.note ?? "");
  const [mode, setMode] = useState<LinkMode>(
    node.link?.type === "url" ? "url" : node.link?.type === "mention" ? "record" : "none",
  );
  const [url, setUrl] = useState(node.link?.type === "url" ? node.link.href : "");
  const [record, setRecord] = useState<MapLink | null>(
    node.link?.type === "mention" ? node.link : null,
  );
  const [color, setColor] = useState<BranchColor | undefined>(node.color);
  const [query, setQuery] = useState("");
  const [urlError, setUrlError] = useState(false);
  const debounced = useDebouncedValue(query.trim(), 150);
  const search = useMentionSearch(debounced);
  const groups = useMemo(() => groupByKind(search.data ?? [], 4), [search.data]);

  function submit(event: FormEvent) {
    event.preventDefault();
    let link: MapLink | undefined;
    if (mode === "url" && url.trim()) {
      const href = normalizeUrl(url);
      if (!href) {
        setUrlError(true);
        return;
      }
      link = { type: "url", href };
    } else if (mode === "record" && record) {
      link = record;
    }
    if (link?.type === "mention" && (node.link?.type !== "mention" || node.link.attrs.id !== link.attrs.id)) {
      track("note_mention_added", { target: link.attrs.type, how: "button" });
    }
    onSave({
      title: cleanNodeTitle(title, root ? MAP_LIMITS.rootTitle : MAP_LIMITS.title),
      note: note.trim().slice(0, MAP_LIMITS.note) || undefined,
      link,
      color,
    });
  }

  const recordLabel =
    record?.type === "mention"
      ? (target?.exists && node.link?.type === "mention" && node.link.attrs.id === record.attrs.id
          ? target.label
          : record.attrs.label) || record.attrs.label
      : "";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="note-map-details">
      <FormField id="map-node-title" label={root ? t("rootLabel") : t("textLabel")}>
        <Input
          value={title}
          maxLength={root ? MAP_LIMITS.rootTitle : MAP_LIMITS.title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
          {...fieldA11y("map-node-title")}
        />
      </FormField>
      <FormField id="map-node-note" label={t("noteLabel")} hint={t("noteHint")}>
        <Textarea
          value={note}
          maxLength={MAP_LIMITS.note}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
          {...fieldA11y("map-node-note", undefined, true)}
        />
      </FormField>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">{t("linkLabel")}</legend>
        <div role="radiogroup" aria-label={t("linkLabel")} className="flex flex-wrap gap-1.5">
          {(["none", "url", "record"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "min-h-11 rounded-xl border px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9",
                mode === value ? "border-violet bg-violet/14 text-ink" : "border-line text-ink-soft hover:text-ink",
              )}
            >
              {t(`linkMode.${value}`)}
            </button>
          ))}
        </div>
        {mode === "url" && (
          <FormField id="map-node-url" label={t("urlLabel")} error={urlError ? t("urlInvalid") : undefined}>
            <Input
              type="url"
              inputMode="url"
              value={url}
              placeholder="https://"
              onChange={(event) => {
                setUrl(event.target.value);
                setUrlError(false);
              }}
              {...fieldA11y("map-node-url", urlError ? "x" : undefined)}
            />
          </FormField>
        )}
        {mode === "record" && (
          <div className="flex flex-col gap-2">
            {record?.type === "mention" && (
              <p className="flex items-center gap-2 text-sm text-ink">
                <Link2Icon aria-hidden className="size-4 text-violet" />
                <span className="min-w-0 flex-1 truncate">{recordLabel}</span>
                <button
                  type="button"
                  onClick={() => setRecord(null)}
                  aria-label={t("recordRemove")}
                  className="grid size-11 place-items-center rounded-lg text-ink-muted hover:text-ink mouse:size-8"
                >
                  <XIcon aria-hidden className="size-4" />
                </button>
              </p>
            )}
            <Input
              type="search"
              value={query}
              placeholder={t("recordSearch")}
              aria-label={t("recordSearch")}
              onChange={(event) => setQuery(event.target.value)}
              data-testid="note-map-record-search"
            />
            {debounced.length >= 2 && (
              <div className="flex max-h-56 flex-col overflow-y-auto overscroll-contain">
                {groups.length === 0 && (
                  <p className="px-2 py-2 text-sm text-ink-muted">
                    {search.isFetching ? t("searching") : t("noResults")}
                  </p>
                )}
                {groups.map((group) => (
                  <div key={group.kind} role="group" aria-label={tKind(group.kind)} className="flex flex-col">
                    <p aria-hidden className="micro-label px-2 pt-2 pb-1">
                      {tKind(group.kind)}
                    </p>
                    {group.options.map((option) => {
                      const Icon = KIND_ICONS[option.type];
                      const chosen = record?.type === "mention" && record.attrs.id === option.id;
                      return (
                        <button
                          key={`${option.type}:${option.id}`}
                          type="button"
                          onClick={() => {
                            setRecord({
                              type: "mention",
                              attrs: { type: option.type, id: option.id, label: option.label },
                            });
                            setQuery("");
                          }}
                          className={cn(
                            "flex min-h-11 items-center gap-2.5 rounded-xl px-2 text-left text-sm outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9",
                            chosen && "bg-violet/14",
                          )}
                        >
                          <Icon aria-hidden className="size-4 shrink-0 text-ink-soft" />
                          <span className="min-w-0 flex-1 truncate text-ink">{option.label}</span>
                          {chosen && <CheckIcon aria-hidden className="size-4 text-violet" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">{t("colorLabel")}</legend>
        <div role="radiogroup" aria-label={t("colorLabel")} className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            role="radio"
            aria-checked={!color}
            onClick={() => setColor(undefined)}
            className={cn(
              "min-h-11 rounded-xl border px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9",
              !color ? "border-violet bg-violet/14 text-ink" : "border-line text-ink-soft hover:text-ink",
            )}
          >
            {t("colorAuto")}
            {!color && shownColor && (
              <span aria-hidden className={cn("ml-2 inline-block size-2.5 rounded-full", COLOR_FILL[shownColor])} />
            )}
          </button>
          {BRANCH_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={color === value}
              aria-label={t(`color.${value}`)}
              title={t(`color.${value}`)}
              onClick={() => setColor(value)}
              className={cn(
                "grid size-11 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-9",
                color === value && "ring-2 ring-ink",
              )}
            >
              <span aria-hidden className={cn("size-6 rounded-full", COLOR_FILL[value])} />
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" data-testid="note-map-details-save">
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
