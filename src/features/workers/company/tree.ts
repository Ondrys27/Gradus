import type { Tone } from "@/components/ui/tone";
import type { WorkerStatus } from "../types";

/**
 * The company as a tree. The owner is the root and never a worker row; a
 * worker sits under their manager (`managerId`), or right under the owner
 * when it is null. A worker sees their own branch: they are its root.
 *
 * Pure functions, shared by the list, the map and the "Move under…" dialog;
 * the database (workers_hierarchy_guard) refuses the same cycles again.
 */

/** Id of the owner's node in the views; never a worker id (those are uuids). */
export const OWNER_ROOT = "owner";

export type CompanyPerson = {
  id: string;
  name: string;
  jobTitle: string | null;
  status: WorkerStatus;
  managerId: string | null;
  /** The account, once the invite is accepted. */
  userId: string | null;
  avatarUrl: string | null;
  openTasks: number;
  openDeals: number;
  groupIds: string[];
};

export const GROUP_TONES = ["violet", "teal", "gold", "green", "pink", "neutral"] as const;
export type GroupTone = (typeof GROUP_TONES)[number] & Tone;

export function groupTone(color: string): GroupTone {
  return (GROUP_TONES as readonly string[]).includes(color) ? (color as GroupTone) : "neutral";
}

export type CompanyGroup = {
  id: string;
  name: string;
  color: GroupTone;
  description: string | null;
  position: number;
  /** Visible people in the group. */
  memberCount: number;
};

export type CompanyNode = {
  id: string;
  /** Null for the owner's root. */
  person: CompanyPerson | null;
  children: CompanyNode[];
};

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const byName = (a: CompanyPerson, b: CompanyPerson) =>
  collator.compare(a.name, b.name) || a.id.localeCompare(b.id);

/** Who is directly under whom; the owner's people under OWNER_ROOT. */
function childrenIndex(people: readonly CompanyPerson[]): Map<string, CompanyPerson[]> {
  const ids = new Set(people.map((person) => person.id));
  const index = new Map<string, CompanyPerson[]>();
  for (const person of people) {
    const parent =
      person.managerId && ids.has(person.managerId) && person.managerId !== person.id
        ? person.managerId
        : OWNER_ROOT;
    const list = index.get(parent) ?? [];
    list.push(person);
    index.set(parent, list);
  }
  index.forEach((list) => list.sort(byName));
  return index;
}

/**
 * The tree under `rootId`: OWNER_ROOT for the owner's whole company, or a
 * worker's id for their own branch. Anyone the walk does not reach (a manager
 * out of sight, a loop that should never exist) is hung right under the root,
 * so nobody is ever lost from view.
 */
export function buildCompanyTree(
  people: readonly CompanyPerson[],
  rootId: string = OWNER_ROOT,
): CompanyNode {
  const index = childrenIndex(people);
  const byId = new Map(people.map((person) => [person.id, person]));
  const seen = new Set<string>([rootId]);

  const grow = (person: CompanyPerson): CompanyNode => {
    seen.add(person.id);
    const children = (index.get(person.id) ?? []).filter((child) => !seen.has(child.id));
    children.forEach((child) => seen.add(child.id));
    return { id: person.id, person, children: children.map(grow) };
  };

  const rootPerson = rootId === OWNER_ROOT ? null : (byId.get(rootId) ?? null);
  const top = rootId === OWNER_ROOT ? (index.get(OWNER_ROOT) ?? []) : (index.get(rootId) ?? []);
  top.forEach((child) => seen.add(child.id));
  const root: CompanyNode = { id: rootId, person: rootPerson, children: top.map(grow) };

  const unreached = people.filter((person) => !seen.has(person.id)).sort(byName);
  for (const person of unreached) {
    if (seen.has(person.id)) continue;
    root.children.push(grow(person));
  }
  return root;
}

/** The worker and everyone below them, however deep. */
export function subtreeIds(people: readonly CompanyPerson[], id: string): Set<string> {
  const index = childrenIndex(people);
  const found = new Set<string>();
  const walk = (current: string) => {
    if (found.has(current)) return;
    found.add(current);
    (index.get(current) ?? []).forEach((child) => walk(child.id));
  };
  walk(id);
  return found;
}

/** Whether putting the worker under this manager (null = the owner) would close a loop. */
export function wouldCreateCycle(
  people: readonly CompanyPerson[],
  workerId: string,
  managerId: string | null,
): boolean {
  if (managerId === null || managerId === OWNER_ROOT) return false;
  return subtreeIds(people, workerId).has(managerId);
}

export type ManagerMove =
  | { ok: true; changed: boolean; managerId: string | null }
  | { ok: false; error: "unknown" | "cycle" };

/**
 * What a drop or a pick of "Move under…" means: the new manager (null = right
 * under the owner), or why it cannot happen. Everything below the worker goes
 * along, since only the worker's own manager changes.
 */
export function planManagerMove(
  people: readonly CompanyPerson[],
  workerId: string,
  target: string | null,
): ManagerMove {
  const managerId = target === OWNER_ROOT ? null : target;
  const worker = people.find((person) => person.id === workerId);
  if (!worker) return { ok: false, error: "unknown" };
  if (managerId !== null && !people.some((person) => person.id === managerId)) {
    return { ok: false, error: "unknown" };
  }
  if (wouldCreateCycle(people, workerId, managerId)) return { ok: false, error: "cycle" };
  return { ok: true, changed: worker.managerId !== managerId, managerId };
}

/** The people after the move: one manager changed, the branch keeps its shape. */
export function moveWorker(
  people: readonly CompanyPerson[],
  workerId: string,
  managerId: string | null,
): CompanyPerson[] {
  return people.map((person) => (person.id === workerId ? { ...person, managerId } : person));
}

/** Levels above a worker up to the owner: 1 = right under the owner. */
export function depthOf(people: readonly CompanyPerson[], id: string): number {
  const byId = new Map(people.map((person) => [person.id, person]));
  let depth = 0;
  let current = byId.get(id);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = current.managerId ? byId.get(current.managerId) : undefined;
  }
  return depth;
}

export type CompanyRow = {
  node: CompanyNode;
  depth: number;
  /** Everything below, shown on a collapsed row. */
  below: number;
  collapsed: boolean;
};

export function countBelow(node: CompanyNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countBelow(child), 0);
}

/** The tree as indented rows, the root first; a collapsed branch keeps only its own row. */
export function flattenCompanyTree(
  root: CompanyNode,
  collapsed: ReadonlySet<string>,
): CompanyRow[] {
  const rows: CompanyRow[] = [];
  const walk = (node: CompanyNode, depth: number) => {
    const isCollapsed = collapsed.has(node.id) && node.children.length > 0;
    rows.push({ node, depth, below: countBelow(node), collapsed: isCollapsed });
    if (!isCollapsed) node.children.forEach((child) => walk(child, depth + 1));
  };
  walk(root, 0);
  return rows;
}

/**
 * The managers a worker can go under, in tree order with their level: the
 * owner first, never the worker themself or anyone below them.
 */
export function managerChoices(
  people: readonly CompanyPerson[],
  workerId: string,
): { id: string; person: CompanyPerson | null; depth: number }[] {
  const excluded = subtreeIds(people, workerId);
  return flattenCompanyTree(buildCompanyTree(people), new Set())
    .filter((row) => !excluded.has(row.node.id))
    .map((row) => ({ id: row.node.id, person: row.node.person, depth: row.depth }));
}

/**
 * A group filter: the members, plus everyone above them as context, so the
 * tree keeps its shape. Null when nothing is filtered.
 */
export function groupFilter(
  people: readonly CompanyPerson[],
  groupId: string | null,
): { members: Set<string>; context: Set<string> } | null {
  if (!groupId) return null;
  const byId = new Map(people.map((person) => [person.id, person]));
  const members = new Set(
    people.filter((person) => person.groupIds.includes(groupId)).map((person) => person.id),
  );
  const context = new Set<string>();
  for (const id of members) {
    let manager = byId.get(id)?.managerId;
    while (manager && !members.has(manager) && !context.has(manager) && byId.has(manager)) {
      context.add(manager);
      manager = byId.get(manager)?.managerId;
    }
  }
  return { members, context };
}

/** The tree with only what the filter keeps; the root always stays. */
export function pruneTree(root: CompanyNode, keep: ReadonlySet<string> | null): CompanyNode {
  if (!keep) return root;
  const prune = (node: CompanyNode): CompanyNode => ({
    ...node,
    children: node.children.filter((child) => keep.has(child.id)).map(prune),
  });
  return prune(root);
}

/** The new members and the ones that left, from the group's members before and after. */
export function membershipDiff(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const was = new Set(before);
  const is = new Set(after);
  return {
    added: [...is].filter((id) => !was.has(id)),
    removed: [...was].filter((id) => !is.has(id)),
  };
}

/** Members of each group, from the people's group ids. */
export function membersByGroup(people: readonly CompanyPerson[]): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const person of [...people].sort(byName)) {
    for (const groupId of person.groupIds) {
      const list = members.get(groupId) ?? [];
      list.push(person.id);
      members.set(groupId, list);
    }
  }
  return members;
}
