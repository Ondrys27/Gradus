export type Size = { width: number; height: number };
export type Box = Size & { x: number; y: number; depth: number };
export type MapBranch = { id: string; children: MapBranch[] };
export type MapEdge = { parentId: string; childId: string };
export type MapLayout = {
  boxes: Map<string, Box>;
  edges: MapEdge[];
  width: number;
  height: number;
};
export type View = { x: number; y: number; scale: number };
/**
 * Horizontal: the root on the left, levels to the right (tasks, rewards).
 * Vertical: the root on top, levels below (an organisation chart).
 */
export type Orientation = "horizontal" | "vertical";

export const COLUMN_GAP = 72;
/** Vertical trees: the gap between two levels and between two siblings. */
export const LEVEL_GAP_VERTICAL = 64;
export const SIBLING_GAP_VERTICAL = 20;
/** Class of a node wrapper the map never pans from: a drag handle (TreeMap `wrapNode`). */
export const MAP_DRAG_NODE = "map-drag-node";
export const ROW_GAP = 16;

/** Everything below a branch, however deep. Shown on a collapsed node. */
export function descendantCount(branch: MapBranch): number {
  return branch.children.reduce((sum, child) => sum + 1 + descendantCount(child), 0);
}

/**
 * The tree from measured node sizes. Horizontal: every depth is a column as
 * wide as its widest node and a parent sits centred on the span of its
 * children. Vertical is the same layout turned: every depth is a row as tall
 * as its tallest node, a parent centred above its children. Returns null until
 * every visible node has been measured, so nothing is ever placed from a
 * guessed size.
 */
export function layoutTree(
  root: MapBranch,
  sizes: ReadonlyMap<string, Size>,
  collapsed: ReadonlySet<string>,
  orientation: Orientation = "horizontal",
): MapLayout | null {
  if (orientation === "horizontal") {
    return layoutAcross(root, sizes, collapsed, COLUMN_GAP, ROW_GAP);
  }
  // Lay out with width and height swapped, then turn the result back.
  const turned = new Map<string, Size>();
  sizes.forEach((size, id) => turned.set(id, { width: size.height, height: size.width }));
  const across = layoutAcross(root, turned, collapsed, LEVEL_GAP_VERTICAL, SIBLING_GAP_VERTICAL);
  if (!across) return null;
  const boxes = new Map<string, Box>();
  across.boxes.forEach((box, id) =>
    boxes.set(id, { x: box.y, y: box.x, width: box.height, height: box.width, depth: box.depth }),
  );
  return { boxes, edges: across.edges, width: across.height, height: across.width };
}

function layoutAcross(
  root: MapBranch,
  sizes: ReadonlyMap<string, Size>,
  collapsed: ReadonlySet<string>,
  columnGap: number,
  rowGap: number,
): MapLayout | null {
  const visibleChildren = (branch: MapBranch) => (collapsed.has(branch.id) ? [] : branch.children);

  const columnWidths: number[] = [];
  const blockHeights = new Map<string, number>();
  let complete = true;

  // First pass: column widths and the height every subtree needs.
  const measure = (branch: MapBranch, depth: number): number => {
    const size = sizes.get(branch.id);
    if (!size) complete = false;
    const width = size?.width ?? 0;
    const height = size?.height ?? 0;
    columnWidths[depth] = Math.max(columnWidths[depth] ?? 0, width);
    const children = visibleChildren(branch);
    const childrenHeight = children.length
      ? children.reduce((sum, child) => sum + measure(child, depth + 1), 0) +
        rowGap * (children.length - 1)
      : 0;
    const block = Math.max(height, childrenHeight);
    blockHeights.set(branch.id, block);
    return block;
  };
  const totalHeight = measure(root, 0);
  if (!complete) return null;

  const columnX: number[] = [];
  columnWidths.forEach((_, depth) => {
    columnX[depth] = depth === 0 ? 0 : columnX[depth - 1] + columnWidths[depth - 1] + columnGap;
  });

  const boxes = new Map<string, Box>();
  const edges: MapEdge[] = [];

  // Second pass: positions, top-down.
  const place = (branch: MapBranch, depth: number, top: number) => {
    const size = sizes.get(branch.id)!;
    const block = blockHeights.get(branch.id)!;
    const children = visibleChildren(branch);
    let y = top;

    if (children.length) {
      const childrenHeight =
        children.reduce((sum, child) => sum + blockHeights.get(child.id)!, 0) +
        rowGap * (children.length - 1);
      let childTop = top + (block - childrenHeight) / 2;
      for (const child of children) {
        place(child, depth + 1, childTop);
        childTop += blockHeights.get(child.id)! + rowGap;
        edges.push({ parentId: branch.id, childId: child.id });
      }
      const first = boxes.get(children[0].id)!;
      const last = boxes.get(children[children.length - 1].id)!;
      const centre = (first.y + first.height / 2 + last.y + last.height / 2) / 2;
      y = Math.min(Math.max(centre - size.height / 2, top), top + block - size.height);
    }

    boxes.set(branch.id, { x: columnX[depth], y, depth, ...size });
  };
  place(root, 0, 0);

  const lastColumn = columnWidths.length - 1;
  return {
    boxes,
    edges,
    width: columnX[lastColumn] + columnWidths[lastColumn],
    height: totalHeight,
  };
}

type Point = { x: number; y: number };

/** Where an edge leaves a parent: its right middle, or its bottom middle when vertical. */
function parentPort(from: Box, orientation: Orientation): Point {
  return orientation === "horizontal"
    ? { x: from.x + from.width, y: from.y + from.height / 2 }
    : { x: from.x + from.width / 2, y: from.y + from.height };
}

function ports(from: Box, to: Box, orientation: Orientation): [Point, Point, Point, Point] {
  const start = parentPort(from, orientation);
  if (orientation === "vertical") {
    const end = { x: to.x + to.width / 2, y: to.y };
    const bend = (end.y - start.y) / 2;
    return [start, { x: start.x, y: start.y + bend }, { x: end.x, y: end.y - bend }, end];
  }
  const end = { x: to.x, y: to.y + to.height / 2 };
  const bend = (end.x - start.x) / 2;
  return [start, { x: start.x + bend, y: start.y }, { x: end.x - bend, y: end.y }, end];
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * A smooth cubic from the parent's right middle to the child's left middle
 * (vertical: from the parent's bottom middle to the child's top middle).
 */
export function edgePath(from: Box, to: Box, orientation: Orientation = "horizontal"): string {
  const [a, b, c, d] = ports(from, to, orientation);
  return `M ${round(a.x)} ${round(a.y)} C ${round(b.x)} ${round(b.y)} ${round(c.x)} ${round(c.y)} ${round(d.x)} ${round(d.y)}`;
}

/** The same path shrunk to the parent's port: where a new edge grows from. */
export function collapsedEdgePath(from: Box, orientation: Orientation = "horizontal"): string {
  const port = parentPort(from, orientation);
  const x = round(port.x);
  const y = round(port.y);
  return `M ${x} ${y} C ${x} ${y} ${x} ${y} ${x} ${y}`;
}

/** Arc length of the edge, sampled. Drives the travelling shine. */
export function edgeLength(
  from: Box,
  to: Box,
  samples = 24,
  orientation: Orientation = "horizontal",
): number {
  const [a, b, c, d] = ports(from, to, orientation);
  const at = (t: number): Point => {
    const u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
      y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
    };
  };
  let length = 0;
  let previous = a;
  for (let step = 1; step <= samples; step++) {
    const point = at(step / samples);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

/**
 * The starting view: the whole tree when it fits (never enlarged past 100 %),
 * otherwise as small as still readable with the root kept in sight: on the
 * left of a horizontal tree (rootCentre is its y), on top of a vertical one
 * (rootCentre is its x).
 */
export function fitView(
  content: Size,
  viewport: Size,
  rootCentre: number,
  { minScale = 0.75, maxScale = 1, padding = 24, orientation = "horizontal" as Orientation } = {},
): View {
  const room = { width: viewport.width - padding * 2, height: viewport.height - padding * 2 };
  const fit = Math.min(room.width / content.width, room.height / content.height);
  const scale = Math.min(Math.max(fit, minScale), maxScale);
  const width = content.width * scale;
  const height = content.height * scale;
  const aroundRoot = (viewportSize: number, contentSize: number) =>
    Math.min(
      Math.max(viewportSize / 2 - rootCentre * scale, viewportSize - padding - contentSize),
      padding,
    );

  if (orientation === "vertical") {
    const x =
      width <= room.width ? (viewport.width - width) / 2 : aroundRoot(viewport.width, width);
    const y = height <= room.height ? (viewport.height - height) / 2 : padding;
    return { x, y, scale };
  }
  const x = width <= room.width ? (viewport.width - width) / 2 : padding;
  const y =
    height <= room.height ? (viewport.height - height) / 2 : aroundRoot(viewport.height, height);
  return { x, y, scale };
}
