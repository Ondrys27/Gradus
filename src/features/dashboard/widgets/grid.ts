/**
 * The grid of the dashboard (28.5): four columns on a computer, two on a tablet
 * and two narrow ones on a phone. Pure functions, no React.
 *
 * The order of the items is the truth: a layout is a list, and every width
 * places it by first fit (each item at the first free cell, reading order,
 * where it fits), like widgets on an iPhone. So a widget added at the end
 * flies to the first free place, a hidden widget leaves no hole, and the
 * narrower grid is the same order with L and XL across the whole width.
 * `x` / `y` are stored for the four columns (`withPositions`), never read back
 * as the order.
 */

export const WIDGET_SIZES = ["S", "M", "L", "XL"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

/** Columns × rows of each size on the full grid. */
export const SIZE_SPANS: Record<WidgetSize, { w: number; h: number }> = {
  S: { w: 1, h: 1 },
  M: { w: 2, h: 1 },
  L: { w: 2, h: 2 },
  XL: { w: 4, h: 2 },
};

export const FULL_COLUMNS = 4;
export const NARROW_COLUMNS = 2;
/** Grid width from which four columns fit (px of the grid itself, not the window). */
export const FOUR_COLUMNS_FROM = 880;

/** At most this many widgets on one dashboard and this many dashboards (tabs). */
export const MAX_ITEMS = 40;
export const MAX_LAYOUTS = 6;

export type LayoutItem = {
  /** Stable per placed widget, so the same widget can be on the board twice. */
  id: string;
  widget: string;
  size: WidgetSize;
  x: number;
  y: number;
  settings: Record<string, unknown>;
};

export type Placement = { id: string; x: number; y: number; w: number; h: number };

export function isWidgetSize(value: unknown): value is WidgetSize {
  return typeof value === "string" && (WIDGET_SIZES as readonly string[]).includes(value);
}

/** How many columns a grid of this width has. */
export function columnsFor(width: number): number {
  return width >= FOUR_COLUMNS_FROM ? FULL_COLUMNS : NARROW_COLUMNS;
}

/** The span of a size on a grid of `cols` columns: never wider than the grid. */
export function spanOf(size: WidgetSize, cols: number): { w: number; h: number } {
  const span = SIZE_SPANS[size];
  return { w: Math.min(span.w, cols), h: span.h };
}

/** Whether two placements share a cell. */
export function overlaps(a: Placement, b: Placement): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Any two placements on the same cell, or one outside the grid. */
export function hasCollision(placements: readonly Placement[], cols: number): boolean {
  for (let i = 0; i < placements.length; i += 1) {
    const a = placements[i];
    if (a.x < 0 || a.y < 0 || a.x + a.w > cols) return true;
    for (let j = i + 1; j < placements.length; j += 1) {
      if (overlaps(a, placements[j])) return true;
    }
  }
  return false;
}

/**
 * First fit in order: each item at the first cell (row by row, left to right)
 * where its whole span is free. Never overlaps, never leaves the grid.
 */
export function arrange(
  items: readonly Pick<LayoutItem, "id" | "size">[],
  cols: number,
): Placement[] {
  const occupied: boolean[][] = [];
  const free = (x: number, y: number, w: number, h: number) => {
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        if (occupied[row]?.[col]) return false;
      }
    }
    return true;
  };
  const take = (x: number, y: number, w: number, h: number) => {
    for (let row = y; row < y + h; row += 1) {
      occupied[row] ??= [];
      for (let col = x; col < x + w; col += 1) occupied[row][col] = true;
    }
  };
  const placements: Placement[] = [];
  for (const item of items) {
    const { w, h } = spanOf(item.size, cols);
    for (let y = 0; ; y += 1) {
      let placed = false;
      for (let x = 0; x + w <= cols; x += 1) {
        if (free(x, y, w, h)) {
          take(x, y, w, h);
          placements.push({ id: item.id, x, y, w, h });
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
  }
  return placements;
}

/** Rows the placements take. */
export function rowsOf(placements: readonly Placement[]): number {
  return placements.reduce((rows, p) => Math.max(rows, p.y + p.h), 0);
}

/** The items with `x` / `y` of the full grid filled in, as they are stored. */
export function withPositions(items: readonly LayoutItem[]): LayoutItem[] {
  const placements = new Map(arrange(items, FULL_COLUMNS).map((p) => [p.id, p]));
  return items.map((item) => {
    const p = placements.get(item.id);
    return p ? { ...item, x: p.x, y: p.y } : item;
  });
}

/** Moves the item to position `toIndex` of the order; the rest keep theirs. */
export function moveItem(items: readonly LayoutItem[], id: string, toIndex: number): LayoutItem[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  const index = Math.max(0, Math.min(toIndex, next.length));
  next.splice(index, 0, moved);
  return withPositions(next);
}

export function resizeItem(
  items: readonly LayoutItem[],
  id: string,
  size: WidgetSize,
): LayoutItem[] {
  return withPositions(items.map((item) => (item.id === id ? { ...item, size } : item)));
}

export function removeItem(items: readonly LayoutItem[], id: string): LayoutItem[] {
  return withPositions(items.filter((item) => item.id !== id));
}

/** Appends a widget: first fit puts it at the first free place where it fits. */
export function addItem(items: readonly LayoutItem[], item: LayoutItem): LayoutItem[] {
  if (items.length >= MAX_ITEMS) return [...items];
  return withPositions([...items, item]);
}

export function updateSettings(
  items: readonly LayoutItem[],
  id: string,
  settings: Record<string, unknown>,
): LayoutItem[] {
  return items.map((item) => (item.id === id ? { ...item, settings } : item));
}

/** A short random id for a newly placed widget. */
export function newItemId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Stored JSON → items (the database checks the same shape: dashboard_items_valid)
// ---------------------------------------------------------------------------

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;
/** The settings of one widget, as JSON text, at most. */
export const MAX_SETTINGS_LENGTH = 2000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Only well formed items survive: a known shape, a unique id, at most
 * MAX_ITEMS. Anything else (an older client, a hand edit) is dropped rather
 * than breaking the board. Positions are recomputed from the order.
 */
export function cleanItems(raw: unknown): LayoutItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: LayoutItem[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const { id, widget, size, settings } = entry;
    if (typeof widget !== "string" || !KEY_PATTERN.test(widget)) continue;
    if (!isWidgetSize(size)) continue;
    const itemId = typeof id === "string" && ID_PATTERN.test(id) ? id : newItemId();
    if (seen.has(itemId)) continue;
    const cleanSettings = isPlainObject(settings) ? settings : {};
    if (JSON.stringify(cleanSettings).length > MAX_SETTINGS_LENGTH) continue;
    seen.add(itemId);
    items.push({ id: itemId, widget, size, x: 0, y: 0, settings: cleanSettings });
    if (items.length >= MAX_ITEMS) break;
  }
  return withPositions(items);
}

/** Two layouts that look the same (order, sizes, settings). */
export function sameItems(a: readonly LayoutItem[], b: readonly LayoutItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (item, index) =>
      item.id === b[index].id &&
      item.widget === b[index].widget &&
      item.size === b[index].size &&
      JSON.stringify(item.settings) === JSON.stringify(b[index].settings),
  );
}
