/**
 * What an owner can let a worker do, section by section. Mirrors
 * permission_catalog() in supabase/migrations/20261103200000_worker_dashboard.sql
 * (a Vitest compares them); the database decides with has_permission(), this
 * file only shapes the interface (useCan, the Rights tab, the templates).
 *
 * Every section with rights starts with `view` ("sees the section"); the other
 * actions only count together with it. Kinds:
 * - `view`: implied by the older "sees the section" (worker_permissions.can_view)
 * - `read`: more to see, never implied, granted on its own
 * - `write`: changes something; any of them is the older "edit"
 *
 * Dashboard, notes and settings have no rights: the worker's own dashboard
 * and account are always theirs, the owner's notes and settings never are.
 */

export type ActionKind = "view" | "read" | "write";

type ActionDef = { readonly key: string; readonly kind: ActionKind };

/** A row of the Rights tab. `nav` is the key of its name under `nav.*`. */
type SectionDef = {
  readonly key: string;
  readonly nav: string;
  /** No switches: always the worker's own, or never open to them. */
  readonly fixed?: "always" | "never";
  /** "view" is on without a row (Tasks: own tasks; Company: own branch). */
  readonly viewByDefault?: boolean;
  readonly actions: readonly ActionDef[];
};

export const PERMISSION_CATALOG = [
  { key: "dashboard", nav: "dashboard", fixed: "always", actions: [] },
  {
    key: "milestones",
    nav: "milestones",
    actions: [
      { key: "view", kind: "view" },
      { key: "update", kind: "write" },
    ],
  },
  { key: "notes", nav: "notes", fixed: "never", actions: [] },
  {
    key: "contacts",
    nav: "contacts",
    actions: [
      { key: "view", kind: "view" },
      { key: "create", kind: "write" },
      { key: "update", kind: "write" },
      { key: "delete", kind: "write" },
      { key: "export", kind: "read" },
      { key: "generate", kind: "write" },
    ],
  },
  {
    key: "pipeline",
    nav: "pipeline",
    actions: [
      { key: "view", kind: "view" },
      { key: "view_all", kind: "view" },
      { key: "see_amounts", kind: "view" },
      { key: "create", kind: "write" },
      { key: "update", kind: "write" },
      { key: "change_stage", kind: "write" },
      { key: "change_amount", kind: "write" },
      { key: "delete", kind: "write" },
    ],
  },
  {
    key: "tasks",
    nav: "tasks",
    viewByDefault: true,
    actions: [
      { key: "view", kind: "view" },
      { key: "view_all", kind: "view" },
      { key: "create", kind: "write" },
      { key: "update", kind: "write" },
      { key: "assign_others", kind: "write" },
      { key: "delete", kind: "write" },
    ],
  },
  {
    key: "cold_calling",
    nav: "coldCalling",
    actions: [
      { key: "view", kind: "view" },
      { key: "call", kind: "write" },
      { key: "view_others_stats", kind: "read" },
    ],
  },
  {
    key: "calendar",
    nav: "calendar",
    actions: [
      { key: "view", kind: "view" },
      { key: "view_all", kind: "view" },
      { key: "create", kind: "write" },
      { key: "update", kind: "write" },
    ],
  },
  {
    // Scheduler (24.3): "own" = their own booking page, meeting types and
    // bookings in this company; nobody else's, ever.
    key: "scheduler",
    nav: "scheduler",
    actions: [
      { key: "view", kind: "view" },
      { key: "own", kind: "write" },
    ],
  },
  {
    key: "finance",
    nav: "finance",
    actions: [
      { key: "view", kind: "view" },
      { key: "summaries", kind: "view" },
      { key: "write", kind: "write" },
    ],
  },
  {
    key: "invoices",
    nav: "invoices",
    actions: [
      { key: "view", kind: "view" },
      { key: "issue", kind: "write" },
    ],
  },
  {
    key: "company",
    nav: "workers",
    viewByDefault: true,
    actions: [
      { key: "view", kind: "view" },
      { key: "view_all", kind: "read" },
      { key: "update", kind: "write" },
    ],
  },
  { key: "settings", nav: "settings", fixed: "never", actions: [] },
] as const satisfies readonly SectionDef[];

type Catalog = typeof PERMISSION_CATALOG;
export type CatalogSection = Catalog[number];
export type CatalogSectionKey = CatalogSection["key"];
/** Sections whose rights the owner sets. */
export type GrantSection = Exclude<CatalogSection, { fixed: string }>["key"];
export type GrantAction<S extends GrantSection = GrantSection> = Extract<
  CatalogSection,
  { key: S }
>["actions"][number]["key"];

/** Allowed actions per section, as stored in worker_permission_grants. */
export type PermissionGrants = { [S in GrantSection]?: readonly GrantAction<S>[] };

export const GRANT_SECTIONS = PERMISSION_CATALOG.filter(
  (section): section is Extract<CatalogSection, { key: GrantSection }> =>
    !("fixed" in section) || section.fixed === undefined,
).map((section) => section.key) as GrantSection[];

/**
 * Scope switches render as "all / own" under the section rather than a
 * separate right ("view_all" off = only the worker's own).
 */
export const SCOPE_ACTION = "view_all";

function sectionDef(section: string): SectionDef | undefined {
  return (PERMISSION_CATALOG as readonly SectionDef[]).find((entry) => entry.key === section);
}

export function isGrantSection(value: string): value is GrantSection {
  return (GRANT_SECTIONS as string[]).includes(value);
}

export function isGrantAction<S extends GrantSection>(
  section: S,
  action: string,
): action is GrantAction<S> {
  return Boolean(sectionDef(section)?.actions.some((entry) => entry.key === action));
}

export function actionKind(section: string, action: string): ActionKind {
  const kind = sectionDef(section)?.actions.find((entry) => entry.key === action)?.kind;
  if (!kind) throw new Error(`Unknown right ${section}.${action}`);
  return kind;
}

export function actionsOf<S extends GrantSection>(section: S): GrantAction<S>[] {
  return (sectionDef(section)?.actions ?? []).map((entry) => entry.key) as GrantAction<S>[];
}

/** What holds without a stored row (mirrors permission_default()). */
export function defaultAllowed(section: GrantSection, action: string): boolean {
  return action === "view" && Boolean(sectionDef(section)?.viewByDefault);
}

// ---------------------------------------------------------------------------
// Reading and writing the grants
// ---------------------------------------------------------------------------

export type GrantRow = { section: string; action: string; allowed: boolean };

/** Upper bound of a worker's grant rows (the catalog has fewer). */
export const GRANT_ROWS_LIMIT = 200;

/** Grants from stored rows; unknown rows are ignored, missing ones take the default. */
export function grantsFromRows(rows: readonly GrantRow[]): PermissionGrants {
  const stored = new Map(rows.map((row) => [`${row.section}.${row.action}`, row.allowed]));
  const grants: Record<string, string[]> = {};
  for (const section of GRANT_SECTIONS) {
    const allowed = actionsOf(section).filter(
      (action) => stored.get(`${section}.${action}`) ?? defaultAllowed(section, action),
    );
    if (allowed.length > 0) grants[section] = allowed;
  }
  return grants as PermissionGrants;
}

/** Every right of the catalog as a row to upsert, so nothing is left to a default. */
export function grantRows(grants: PermissionGrants): GrantRow[] {
  return GRANT_SECTIONS.flatMap((section) =>
    actionsOf(section).map((action) => ({
      section,
      action,
      allowed: hasGrant(grants, section, action),
    })),
  );
}

function hasGrant(grants: PermissionGrants, section: GrantSection, action: string): boolean {
  return ((grants[section] ?? []) as readonly string[]).includes(action);
}

/** Whether the grants let the worker do this: the action together with the section's view. */
export function grantAllows(grants: PermissionGrants, section: GrantSection, action: string) {
  return hasGrant(grants, section, "view") && hasGrant(grants, section, action);
}

/** The section is switched on ("sees the section"). */
export function seesSection(grants: PermissionGrants, section: GrantSection): boolean {
  return hasGrant(grants, section, "view");
}

/**
 * One switch. Any right turns "sees the section" on with it; turning that off
 * clears the whole section.
 */
export function toggleGrant(
  grants: PermissionGrants,
  section: GrantSection,
  action: string,
  on: boolean,
): PermissionGrants {
  const current = new Set<string>((grants[section] ?? []) as readonly string[]);
  if (action === "view" && !on) {
    current.clear();
  } else if (on) {
    current.add(action);
    current.add("view");
  } else {
    current.delete(action);
  }
  const ordered = actionsOf(section).filter((key) => current.has(key));
  const next: Record<string, readonly string[]> = { ...grants };
  if (ordered.length > 0) next[section] = ordered;
  else delete next[section];
  return next as PermissionGrants;
}

// ---------------------------------------------------------------------------
// The older coarse rights (worker_permissions), derived like the database
// ---------------------------------------------------------------------------

/** The six sections the older policies read, and the catalog sections behind each. */
export const LEGACY_SOURCES = {
  milestones: ["milestones"],
  contacts: ["contacts"],
  pipeline: ["pipeline"],
  cold_calling: ["cold_calling"],
  calendar: ["calendar"],
  finance: ["finance", "invoices"],
} as const satisfies Record<string, readonly GrantSection[]>;

export type LegacySection = keyof typeof LEGACY_SOURCES;

/** view = some source section is seen; edit = a seen source section has a write right. */
export function legacyAccess(
  grants: PermissionGrants,
  section: LegacySection,
): { view: boolean; edit: boolean } {
  let view = false;
  let edit = false;
  for (const source of LEGACY_SOURCES[section]) {
    if (!seesSection(grants, source)) continue;
    view = true;
    if (
      actionsOf(source).some(
        (action) => actionKind(source, action) === "write" && hasGrant(grants, source, action),
      )
    ) {
      edit = true;
    }
  }
  return { view, edit };
}

/** Any write right in a section the worker sees ("edit" in the older sense). */
export function writesSection(grants: PermissionGrants, section: GrantSection): boolean {
  return (
    seesSection(grants, section) &&
    actionsOf(section).some(
      (action) => actionKind(section, action) === "write" && hasGrant(grants, section, action),
    )
  );
}

// ---------------------------------------------------------------------------
// Templates: one click fills the matrix
// ---------------------------------------------------------------------------

export const PERMISSION_TEMPLATES = ["sales", "assistant", "accountant", "all"] as const;
export type PermissionTemplate = (typeof PERMISSION_TEMPLATES)[number];

const TEMPLATE_GRANTS: Record<Exclude<PermissionTemplate, "all">, PermissionGrants> = {
  // Sells: their contacts, calls and deals, their own tasks and meetings.
  sales: {
    contacts: ["view", "create", "update"],
    pipeline: ["view", "see_amounts", "create", "update", "change_stage", "change_amount"],
    tasks: ["view", "create", "update"],
    cold_calling: ["view", "call"],
    calendar: ["view", "create", "update"],
    scheduler: ["view", "own"],
    company: ["view"],
  },
  // Keeps the plan and the diary: milestones, everyone's tasks and events, contacts.
  assistant: {
    milestones: ["view", "update"],
    contacts: ["view", "create", "update"],
    tasks: ["view", "view_all", "create", "update", "assign_others"],
    calendar: ["view", "view_all", "create", "update"],
    company: ["view"],
  },
  // Keeps the books: finance and invoices, deals and contacts to look up.
  accountant: {
    contacts: ["view"],
    pipeline: ["view", "view_all", "see_amounts"],
    finance: ["view", "summaries", "write"],
    invoices: ["view", "issue"],
    company: ["view"],
  },
};

export function templateGrants(template: PermissionTemplate): PermissionGrants {
  if (template === "all") {
    return Object.fromEntries(
      GRANT_SECTIONS.map((section) => [section, actionsOf(section)]),
    ) as PermissionGrants;
  }
  return TEMPLATE_GRANTS[template];
}

/** The template the grants match exactly, else null (custom). */
export function templateOf(grants: PermissionGrants): PermissionTemplate | null {
  return (
    PERMISSION_TEMPLATES.find((template) => sameGrants(templateGrants(template), grants)) ?? null
  );
}

export function sameGrants(a: PermissionGrants, b: PermissionGrants): boolean {
  return GRANT_SECTIONS.every((section) =>
    actionsOf(section).every((action) => hasGrant(a, section, action) === hasGrant(b, section, action)),
  );
}

/** How many sections the worker sees and how many rights they have, for analytics. */
export function grantCounts(grants: PermissionGrants): { sections: number; actions: number } {
  return {
    sections: GRANT_SECTIONS.filter((section) => seesSection(grants, section)).length,
    actions: GRANT_SECTIONS.reduce(
      (sum, section) => sum + (seesSection(grants, section) ? (grants[section]?.length ?? 0) : 0),
      0,
    ),
  };
}

// ---------------------------------------------------------------------------
// Documents of a worker (bucket worker-documents)
// ---------------------------------------------------------------------------

export const WORKER_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

export const WORKER_DOCUMENT_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "text/plain",
  "text/csv",
] as const;

export type WorkerDocumentMime = (typeof WORKER_DOCUMENT_MIMES)[number];
