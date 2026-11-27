"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CheckIcon, PlusIcon, SearchIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { toneSoft } from "@/components/ui/tone";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { SIZE_SPANS, type LayoutItem, type WidgetSize } from "./grid";
import { haptic, LAYOUT_SPRING, type Rect } from "./motion";
import type { CoreWidgetMeta as WidgetMeta } from "./meta";
import { useWidgetSystem } from "./system";
import { WidgetFrame } from "./widget-frame";

/** A preview is the widget drawn at the size of a board cell, scaled to fit. */
const CELL_W = 176;
const CELL_H = 164;
const GAP = 16;

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


/** Width of an element, live. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * "Add widget" (28.6), like the widget gallery of a phone: every widget the
 * account may use as one large preview drawn from the real data, the sizes
 * it comes in switched with dots under it, what it is for in a line, and
 * Add. The suggested ones (recommend.ts) come first; a search and the
 * categories narrow the rest. Adding tells the board where the preview was,
 * so the new widget flies from it to its place. On a phone it is a bottom
 * sheet, everything within a thumb's reach.
 */
export function WidgetGallery({
  open,
  onOpenChange,
  available,
  placed,
  recommended,
  settingsFor,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: readonly WidgetMeta[];
  /** Keys of the widgets already on the board (a widget may be there twice). */
  placed: readonly string[];
  recommended: readonly WidgetMeta[];
  /**
   * The settings a preview draws with: every setting at its default, a choice
   * the account may not make replaced by one it may (no amounts in the
   * pipeline preview without "see amounts").
   */
  settingsFor: (meta: WidgetMeta) => Record<string, unknown>;
  onAdd: (meta: WidgetMeta, size: WidgetSize, from: Rect | null) => void;
}) {
  const t = useTranslations("dashboard.board");
  const system = useWidgetSystem();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

  const needle = plain(query.trim());
  const shown = useMemo(
    () =>
      available.filter((meta) => {
        if (category !== "all" && meta.category !== category) return false;
        if (!needle) return true;
        const text = plain(`${system.name(meta.key)} ${system.description(meta.key)}`);
        return text.includes(needle);
      }),
    [available, category, needle, system],
  );
  const categories = system.categories.filter((key) =>
    available.some((meta) => meta.category === key),
  );
  const suggesting = !needle && category === "all" && recommended.length > 0;
  const placedSet = useMemo(() => new Set(placed), [placed]);
  // A suggested widget is not listed twice.
  const rest = suggesting
    ? shown.filter((meta) => !recommended.some((entry) => entry.key === meta.key))
    : shown;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("galleryTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,1040px)]"
    >
      <div className="flex flex-col gap-4" data-testid="widget-gallery">
        <div className="flex flex-col gap-3 md:sticky md:-top-6 md:z-10 md:-mx-6 md:bg-surface md:px-6 md:pt-1 md:pb-3">
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
              data-tutorial="dashboard-gallery-search"
              className="h-11 w-full rounded-xl border border-line bg-canvas pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/30"
            />
          </label>
          <div
            className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0"
            role="group"
            aria-label={t("galleryCategories")}
          >
            {["all", ...categories].map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={category === key}
                onClick={() => setCategory(key)}
                className={cn(
                  "min-h-9 shrink-0 cursor-pointer rounded-full border px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
                  category === key
                    ? "border-violet bg-violet/20 text-ink"
                    : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
                )}
              >
                {key === "all" ? t("galleryAll") : system.categoryName(key)}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">{t("galleryEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-6">
            {suggesting && (
              <section className="flex flex-col gap-3" data-testid="gallery-recommended">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <SparklesIcon aria-hidden className="size-4 text-violet" />
                  {t("galleryRecommended")}
                  <span className="text-xs font-normal text-ink-muted">
                    {t("galleryRecommendedHint")}
                  </span>
                </h3>
                <GalleryGrid>
                  {recommended.map((meta) => (
                    <GalleryItem
                      key={meta.key}
                      meta={meta}
                      onBoard={placedSet.has(meta.key)}
                      settings={settingsFor(meta)}
                      onAdd={(size, from) => onAdd(meta, size, from)}
                    />
                  ))}
                </GalleryGrid>
              </section>
            )}
            <section className="flex flex-col gap-3">
              {suggesting && (
                <h3 className="text-sm font-semibold text-ink">{t("galleryAllWidgets")}</h3>
              )}
              <GalleryGrid>
                {rest.map((meta) => (
                  <GalleryItem
                    key={meta.key}
                    meta={meta}
                    onBoard={placedSet.has(meta.key)}
                    settings={settingsFor(meta)}
                    onAdd={(size, from) => onAdd(meta, size, from)}
                  />
                ))}
              </GalleryGrid>
            </section>
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
}

function GalleryGrid({ children }: { children: React.ReactNode }) {
  return <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">{children}</ul>;
}

/**
 * One widget of the gallery: its large preview in the chosen size (the real
 * widget, scaled to the card), dots for the sizes, the name, what it is for
 * and Add. The preview morphs between sizes with a spring.
 */
function GalleryItem({
  meta,
  onBoard,
  settings,
  onAdd,
}: {
  meta: WidgetMeta;
  onBoard: boolean;
  settings: Record<string, unknown>;
  onAdd: (size: WidgetSize, from: Rect | null) => void;
}) {
  const t = useTranslations("dashboard.board");
  const tSizes = useTranslations("dashboard.board.sizes");
  const system = useWidgetSystem();
  const reduceMotion = useReducedMotionSafe();
  const [size, setSize] = useState<WidgetSize>(meta.defaultSize);
  const { ref: areaRef, width: areaWidth } = useWidth<HTMLDivElement>();
  const previewRef = useRef<HTMLDivElement>(null);
  const name = system.name(meta.key);
  const { icon: Icon, tone } = system.appearance(meta.key);

  const box = previewBox(size);
  const widest = previewBox(meta.sizes[meta.sizes.length - 1]).width;
  // One scale for every size of the widget, so S is not larger than its XL.
  const scale = areaWidth > 0 ? Math.min(1, areaWidth / Math.min(widest, 4 * CELL_W + 3 * GAP)) : 0.5;
  const item: LayoutItem = {
    id: `preview-${meta.key}`,
    widget: meta.key,
    size,
    x: 0,
    y: 0,
    settings,
  };

  function add() {
    const rect = previewRef.current?.getBoundingClientRect();
    haptic();
    onAdd(size, rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null);
  }

  return (
    <li
      className="flex flex-col gap-3 rounded-2xl border border-line bg-canvas/40 p-4"
      data-testid="gallery-widget"
      data-widget={meta.key}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg border [&_svg]:size-4",
              toneSoft[tone],
            )}
          >
            <Icon aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col">
            <h3 className="truncate text-base font-semibold text-ink">{name}</h3>
            {onBoard && (
              <span className="flex items-center gap-1 text-xs text-ink-muted">
                <CheckIcon aria-hidden className="size-3" />
                {t("galleryOnBoard")}
              </span>
            )}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={add}
          data-testid="gallery-add"
          data-tutorial="dashboard-gallery-add"
          className="shrink-0"
        >
          <PlusIcon aria-hidden data-icon="inline-start" />
          {t("galleryAddShort")}
        </Button>
      </div>

      <div
        ref={areaRef}
        className="flex min-h-[120px] items-center justify-center rounded-xl py-2"
        data-no-open=""
      >
        <motion.div
          ref={previewRef}
          aria-hidden
          layout
          transition={reduceMotion ? { duration: 0 } : LAYOUT_SPRING}
          className="relative overflow-hidden"
          style={{ width: box.width * scale, height: box.height * scale }}
        >
          <div
            className="pointer-events-none absolute top-0 left-0 origin-top-left select-none"
            style={{ width: box.width, height: box.height, transform: `scale(${scale})` }}
            inert
          >
            <WidgetFrame
              item={item}
              meta={meta}
              name={name}
              settings={settings}
              editing={false}
              scope="gallery"
              eager
            />
          </div>
        </motion.div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-pretty text-ink-soft">
          {system.description(meta.key)}
        </p>
        {meta.sizes.length > 1 ? (
          <div className="flex shrink-0 flex-col items-center gap-0.5">
            <div
              role="radiogroup"
              aria-label={t("gallerySizes")}
              className="flex items-center"
            >
              {meta.sizes.map((option) => {
                const active = option === size;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${tSizes(option)} · ${tSizes(`${option}Span`)}`}
                    onClick={() => {
                      if (active) return;
                      haptic();
                      setSize(option);
                    }}
                    data-testid={`gallery-size-${option}`}
                    className="grid size-11 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "block h-2 rounded-full transition-[width,background-color] duration-300",
                        active ? "w-5 bg-violet" : "w-2 bg-line-strong hover:bg-ink-muted",
                      )}
                    />
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-ink-muted tabular-nums">
              {tSizes(size)} · {tSizes(`${size}Span`)}
            </span>
          </div>
        ) : (
          <span className="shrink-0 text-xs text-ink-muted tabular-nums">
            {tSizes(size)} · {tSizes(`${size}Span`)}
          </span>
        )}
      </div>
    </li>
  );
}
