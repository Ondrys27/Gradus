import type { NavItem, NavKey } from "./nav-items";

/**
 * The groups of the menu (30.9) and what the person did to it. The sidebar
 * has too many sections to read as one list, so they stand in four groups
 * with a small heading each, ordered by how often a day touches them:
 * Today (the dashboard, tasks, the calendar), Sales (contacts, Cold Calling,
 * the pipeline, the scheduler), Business (milestones, notes, finance) and
 * Company (the company, messages, a worker's rewards). A worker sees the same
 * groups with only the sections the owner opened to them; a group with
 * nothing in it is not drawn.
 *
 * The person may pin sections (they move to the top of the menu and fill the
 * phone bar first), hide sections (gone from the menu, the address still
 * works and search still finds them) and reorder them within a group. The
 * choice is `user_settings.nav_prefs`, read and written with the rest of the
 * settings; `parseNavPrefs` is the only way in, so an unknown key or a
 * stale one never reaches the screen.
 */

export const NAV_GROUP_KEYS = ["pinned", "today", "sales", "business", "company"] as const;
export type NavGroupKey = (typeof NAV_GROUP_KEYS)[number];

/** The home of every section; "pinned" is never a home, it is where pins go. */
export const NAV_GROUP_OF: Record<NavKey, Exclude<NavGroupKey, "pinned">> = {
  dashboard: "today",
  tasks: "today",
  calendar: "today",
  contacts: "sales",
  coldCalling: "sales",
  pipeline: "sales",
  scheduler: "sales",
  milestones: "business",
  notes: "business",
  finance: "business",
  workers: "company",
  messages: "company",
  myRewards: "company",
};

/** The default order inside the groups, the same for everyone. */
export const NAV_DEFAULT_ORDER: readonly NavKey[] = [
  "dashboard",
  "tasks",
  "calendar",
  "contacts",
  "coldCalling",
  "pipeline",
  "scheduler",
  "milestones",
  "notes",
  "finance",
  "workers",
  "messages",
  "myRewards",
];

/** The dashboard is home; it can be neither hidden nor unpinned from the phone bar's first slot. */
export const NAV_ALWAYS: NavKey = "dashboard";

/** How many sections the phone bar holds before "More". */
export const BOTTOM_BAR_SLOTS = 5;
/** How many sections may be pinned; the phone bar has that many slots. */
export const MAX_PINNED = BOTTOM_BAR_SLOTS;

export type NavPrefs = {
  /** Sections at the top of the menu and first in the phone bar, in the person's order. */
  pinned: NavKey[];
  /** Sections taken out of the menu (never the dashboard). */
  hidden: NavKey[];
  /** The person's order of sections; a section not listed keeps its default place. */
  order: NavKey[];
};

export const EMPTY_NAV_PREFS: NavPrefs = { pinned: [], hidden: [], order: [] };

const KNOWN = new Set<string>(NAV_DEFAULT_ORDER);

function keys(value: unknown): NavKey[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: NavKey[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !KNOWN.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry as NavKey);
  }
  return out;
}

/** Whatever the database or an older browser kept, as valid preferences. */
export function parseNavPrefs(value: unknown): NavPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_NAV_PREFS;
  const raw = value as Record<string, unknown>;
  const pinned = keys(raw.pinned).slice(0, MAX_PINNED);
  const hidden = keys(raw.hidden).filter((key) => key !== NAV_ALWAYS);
  return { pinned, hidden, order: keys(raw.order) };
}

/** True when nothing differs from the default menu. */
export function isDefaultNavPrefs(prefs: NavPrefs): boolean {
  return prefs.pinned.length === 0 && prefs.hidden.length === 0 && prefs.order.length === 0;
}

/** The order of a list of sections after the person's own order, defaults for the rest. */
export function sortByPrefs<T extends { key: NavKey }>(items: readonly T[], order: readonly NavKey[]): T[] {
  const rank = (key: NavKey) => {
    const own = order.indexOf(key);
    // Own ranks come first, then defaults after them, so a moved item never
    // jumps behind an untouched one that followed it by default.
    return own >= 0 ? own : order.length + NAV_DEFAULT_ORDER.indexOf(key);
  };
  return [...items].sort((a, b) => rank(a.key) - rank(b.key));
}

export type NavGroup<T extends { key: NavKey }> = { key: NavGroupKey; items: T[] };

/**
 * The menu as groups: pinned sections first (no heading), then the four
 * homes in order, hidden sections left out, empty groups dropped. `items`
 * is what the account may open at all (navItemsFor), so rights are already
 * applied; a pinned or hidden section the account cannot open is ignored.
 */
export function groupNavItems<T extends { key: NavKey }>(
  items: readonly T[],
  prefs: NavPrefs,
): NavGroup<T>[] {
  const hidden = new Set(prefs.hidden);
  const visible = items.filter((item) => !hidden.has(item.key));
  const pinnedSet = new Set(prefs.pinned);
  const pinned = prefs.pinned
    .map((key) => visible.find((item) => item.key === key))
    .filter((item): item is T => item !== undefined);
  const groups: NavGroup<T>[] = pinned.length ? [{ key: "pinned", items: pinned }] : [];
  for (const group of NAV_GROUP_KEYS) {
    if (group === "pinned") continue;
    const members = sortByPrefs(
      visible.filter((item) => NAV_GROUP_OF[item.key] === group && !pinnedSet.has(item.key)),
      prefs.order,
    );
    if (members.length) groups.push({ key: group, items: members });
  }
  return groups;
}

/** The menu as one list, in the order the groups draw it. */
export function flattenNavGroups<T extends { key: NavKey }>(groups: readonly NavGroup<T>[]): T[] {
  return groups.flatMap((group) => group.items);
}

/**
 * The phone bar: pinned sections first, then the account's defaults, up to
 * the slots, the dashboard always among them; hidden sections never.
 */
export function bottomBarKeys(
  defaults: readonly NavKey[],
  prefs: NavPrefs,
  available: readonly NavKey[],
): NavKey[] {
  const hidden = new Set(prefs.hidden);
  const can = new Set(available);
  const out: NavKey[] = [];
  for (const key of [NAV_ALWAYS, ...prefs.pinned, ...defaults]) {
    if (!can.has(key) || hidden.has(key) || out.includes(key)) continue;
    out.push(key);
    if (out.length === BOTTOM_BAR_SLOTS) break;
  }
  return out;
}

/** All sections the account has, grouped the same way, hidden ones included: what Settings → Menu edits. */
export function navEditorGroups(items: readonly NavItem[], prefs: NavPrefs): NavGroup<NavItem>[] {
  return groupNavItems(items, { ...prefs, hidden: [] });
}

/** Prefs with a section pinned or unpinned; pinning past the limit does nothing. */
export function togglePinned(prefs: NavPrefs, key: NavKey): NavPrefs {
  if (prefs.pinned.includes(key)) {
    return { ...prefs, pinned: prefs.pinned.filter((entry) => entry !== key) };
  }
  if (prefs.pinned.length >= MAX_PINNED) return prefs;
  return { ...prefs, pinned: [...prefs.pinned, key], hidden: prefs.hidden.filter((entry) => entry !== key) };
}

/** Prefs with a section hidden or shown again; the dashboard stays. */
export function toggleHidden(prefs: NavPrefs, key: NavKey): NavPrefs {
  if (key === NAV_ALWAYS) return prefs;
  if (prefs.hidden.includes(key)) {
    return { ...prefs, hidden: prefs.hidden.filter((entry) => entry !== key) };
  }
  return {
    ...prefs,
    hidden: [...prefs.hidden, key],
    pinned: prefs.pinned.filter((entry) => entry !== key),
  };
}

/**
 * Prefs with a section moved one place up or down among its neighbours
 * (the sections of its group, or the pinned ones). The whole group's order
 * is written, so the move is exactly what the person saw.
 */
export function moveNavItem(
  prefs: NavPrefs,
  neighbours: readonly NavKey[],
  key: NavKey,
  direction: -1 | 1,
): NavPrefs {
  const index = neighbours.indexOf(key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= neighbours.length) return prefs;
  const moved = [...neighbours];
  [moved[index], moved[target]] = [moved[target]!, moved[index]!];
  if (prefs.pinned.includes(key)) return { ...prefs, pinned: moved };
  const others = prefs.order.filter((entry) => !neighbours.includes(entry));
  return { ...prefs, order: [...others, ...moved] };
}
