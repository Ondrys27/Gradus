"use client";

import { useMemo, useState } from "react";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { WIDGET_CATEGORIES, type WidgetCategory, type WidgetMeta } from "./catalog";
import { SIZE_SPANS, type LayoutItem, type WidgetSize } from "./grid";
import { WidgetFrame } from "./widget-frame";

/** A preview cell: the widget drawn at the size of the board, then scaled down. */
const CELL_W = 172;
const CELL_H = 164;
const GAP = 16;
const PREVIEW_SCALE = 0.56;

function previewBox(size: WidgetSize) {
  const { w, h } = SIZE_SPANS[size];
  return { width: w * CELL_W + (w - 1) * GAP, height: h * CELL_H + (h - 1) * GAP };
}

/** Lowercase, without diacritics: "Úkoly" is found by "ukoly". */
function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * "Add widget": the widgets the account may use, by category and with a
 * search, each with live previews in every size it has, drawn from the real
 * data. Adding drops it at the first free place on the board.
 */
export function WidgetGallery({
  open,
  onOpenChange,
  available,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: readonly WidgetMeta[];
  onAdd: (meta: WidgetMeta, size: WidgetSize) => void;
}) {
  const t = useTranslations("dashboard.board");
  const tWidgets = useTranslations("dashboard.widgets");
  const tCategories = useTranslations("dashboard.board.categories");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<WidgetCategory | "all">("all");

  const shown = useMemo(() => {
    const needle = plain(query.trim());
    return available.filter((meta) => {
      if (category !== "all" && meta.category !== category) return false;
      if (!needle) return true;
      const text = plain(
        `${tWidgets(`${meta.key}.name` as "today.name")} ${tWidgets(`${meta.key}.description` as "today.description")}`,
      );
      return text.includes(needle);
    });
  }, [available, category, query, tWidgets]);
  const categories = WIDGET_CATEGORIES.filter((key) =>
    available.some((meta) => meta.category === key),
  );

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("galleryTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,1080px)]"
    >
      <div className="flex flex-col gap-4" data-testid="widget-gallery">
        <label className="relative block">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("gallerySearch")}
            aria-label={t("gallerySearch")}
            className="h-11 w-full rounded-xl border border-line bg-canvas pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/30"
          />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("galleryCategories")}>
          {(["all", ...categories] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
              className={cn(
                "min-h-9 rounded-full border px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
                category === key
                  ? "border-violet bg-violet/20 text-ink"
                  : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
              )}
            >
              {key === "all" ? t("galleryAll") : tCategories(key)}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">{t("galleryEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {shown.map((meta) => (
              <GalleryItem key={meta.key} meta={meta} onAdd={(size) => onAdd(meta, size)} />
            ))}
          </ul>
        )}
      </div>
    </ResponsiveDialog>
  );
}

function GalleryItem({ meta, onAdd }: { meta: WidgetMeta; onAdd: (size: WidgetSize) => void }) {
  const t = useTranslations("dashboard.board");
  const tSizes = useTranslations("dashboard.board.sizes");
  const tWidgets = useTranslations("dashboard.widgets");
  const [size, setSize] = useState<WidgetSize>(meta.defaultSize);
  const name = tWidgets(`${meta.key}.name` as "today.name");
  const settings: Record<string, unknown> = {};
  for (const setting of meta.settings) {
    if (setting.kind === "choice") settings[setting.key] = setting.default;
    else if (setting.kind === "multi") settings[setting.key] = [...setting.default];
  }

  return (
    <li
      className="flex flex-col gap-3 rounded-2xl border border-line p-4"
      data-testid="gallery-widget"
      data-widget={meta.key}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-base font-semibold text-ink">{name}</h3>
          <p className="text-sm text-ink-soft">
            {tWidgets(`${meta.key}.description` as "today.description")}
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => onAdd(size)} data-testid="gallery-add">
          <PlusIcon aria-hidden data-icon="inline-start" />
          {t("galleryAdd", { size: tSizes(size) })}
        </Button>
      </div>
      <div
        className="-mx-1 flex items-start gap-3 overflow-x-auto px-1 pb-1"
        role="radiogroup"
        aria-label={t("gallerySizes")}
      >
        {meta.sizes.map((option) => {
          const box = previewBox(option);
          const item: LayoutItem = {
            id: `preview-${meta.key}-${option}`,
            widget: meta.key,
            size: option,
            x: 0,
            y: 0,
            settings,
          };
          return (
            <div
              key={option}
              onClick={() => setSize(option)}
              className={cn(
                "flex shrink-0 cursor-pointer flex-col items-center gap-1.5 rounded-xl p-1.5",
                size === option ? "bg-violet/15 ring-2 ring-violet/60" : "hover:bg-surface-hover",
              )}
            >
              <div
                aria-hidden
                className="relative overflow-hidden"
                style={{ width: box.width * PREVIEW_SCALE, height: box.height * PREVIEW_SCALE }}
              >
                <div
                  className="pointer-events-none absolute top-0 left-0 origin-top-left select-none"
                  style={{
                    width: box.width,
                    height: box.height,
                    transform: `scale(${PREVIEW_SCALE})`,
                  }}
                  inert
                >
                  <WidgetFrame
                    item={item}
                    meta={meta}
                    name={name}
                    settings={settings}
                    editing={false}
                    scope="gallery"
                  />
                </div>
              </div>
              <button
                type="button"
                role="radio"
                aria-checked={size === option}
                onClick={(event) => {
                  event.stopPropagation();
                  setSize(option);
                }}
                data-testid={`gallery-size-${option}`}
                className="min-h-8 cursor-pointer rounded-full px-2 text-xs text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 aria-checked:text-violet"
              >
                {tSizes(option)}
              </button>
            </div>
          );
        })}
      </div>
    </li>
  );
}
