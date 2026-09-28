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

export const COLUMN_GAP = 72;
export const ROW_GAP = 16;

/** Everything below a branch, however deep. Shown on a collapsed node. */
export function descendantCount(branch: MapBranch): number {
  return branch.children.reduce((sum, child) => sum + 1 + descendantCount(child), 0);
}

/**
 * Horizontal tree, left to right, from measured node sizes. Every depth is a column
 * as wide as its widest node; a parent sits centred on the span of its children.
 * Returns null until every visible node has been measured, so nothing is ever
 * placed from a guessed size.
 */
export function layoutTree(
  root: MapBranch,
  sizes: ReadonlyMap<string, Size>,
  collapsed: ReadonlySet<string>,
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
        ROW_GAP * (children.length - 1)
      : 0;
    const block = Math.max(height, childrenHeight);
    blockHeights.set(branch.id, block);
    return block;
  };
  const totalHeight = measure(root, 0);
  if (!complete) return null;

  const columnX: number[] = [];
  columnWidths.forEach((_, depth) => {
    columnX[depth] = depth === 0 ? 0 : columnX[depth - 1] + columnWidths[depth - 1] + COLUMN_GAP;
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
        ROW_GAP * (children.length - 1);
      let childTop = top + (block - childrenHeight) / 2;
      for (const child of children) {
        place(child, depth + 1, childTop);
        childTop += blockHeights.get(child.id)! + ROW_GAP;
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

function ports(from: Box, to: Box): [Point, Point, Point, Point] {
  const start = { x: from.x + from.width, y: from.y + from.height / 2 };
  const end = { x: to.x, y: to.y + to.height / 2 };
  const bend = (end.x - start.x) / 2;
  return [start, { x: start.x + bend, y: start.y }, { x: end.x - bend, y: end.y }, end];
}

const round = (value: number) => Math.round(value * 10) / 10;

/** A smooth cubic from the parent's right middle to the child's left middle. */
export function edgePath(from: Box, to: Box): string {
  const [a, b, c, d] = ports(from, to);
  return `M ${round(a.x)} ${round(a.y)} C ${round(b.x)} ${round(b.y)} ${round(c.x)} ${round(c.y)} ${round(d.x)} ${round(d.y)}`;
}

/** The same path shrunk to the parent's port: where a new edge grows from. */
export function collapsedEdgePath(from: Box): string {
  const x = round(from.x + from.width);
  const y = round(from.y + from.height / 2);
  return `M ${x} ${y} C ${x} ${y} ${x} ${y} ${x} ${y}`;
}

/** Arc length of the edge, sampled. Drives the travelling shine. */
export function edgeLength(from: Box, to: Box, samples = 24): number {
  const [a, b, c, d] = ports(from, to);
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
 * otherwise as small as still readable with the root kept in sight on the left.
 */
export function fitView(
  content: Size,
  viewport: Size,
  rootCentreY: number,
  { minScale = 0.75, maxScale = 1, padding = 24 } = {},
): View {
  const room = { width: viewport.width - padding * 2, height: viewport.height - padding * 2 };
  const fit = Math.min(room.width / content.width, room.height / content.height);
  const scale = Math.min(Math.max(fit, minScale), maxScale);
  const width = content.width * scale;
  const height = content.height * scale;

  const x = width <= room.width ? (viewport.width - width) / 2 : padding;
  const y =
    height <= room.height
      ? (viewport.height - height) / 2
      : Math.min(
          Math.max(viewport.height / 2 - rootCentreY * scale, viewport.height - padding - height),
          padding,
        );
  return { x, y, scale };
}
