import type { NavKey } from "@/components/layout/nav-items";
import type { WidgetSize } from "./grid";

/**
 * What every widget of the dashboard is (28.5), without React: the key, the
 * category, the sizes that make sense, the rights it needs and its settings.
 * The components live in registry.tsx; names and descriptions in the
 * translations (`dashboard.widgets.<key>.name` / `.description`).
 *
 * A widget the account has no right to is not in the gallery and is left out
 * of a layout quietly (access.ts); its data is refused by row level security
 * anyway, so a layout written by hand shows nothing it should not.
 */

export const WIDGET_CATEGORIES = ["today", "sales", "money", "team", "progress", "tools"] as const;
export type WidgetCategory = (typeof WIDGET_CATEGORIES)[number];

/** A right of the catalog (src/features/workers/permissions-catalog.ts). */
export type RightRef = readonly [section: string, action: string];

export type WidgetRequirement = {
  /** The section must be in the menu and not locked in game mode. */
  nav?: NavKey;
  /** Every one of these rights. */
  rights?: readonly RightRef[];
  /** At least one of these rights. */
  anyRight?: readonly RightRef[];
  /** Only the owner of the space, or only a worker in it. */
  role?: "owner" | "worker";
  /** Only in game mode (level and streak). */
  playing?: true;
};

export type ChoiceSetting = {
  key: string;
  kind: "choice";
  options: readonly string[];
  default: string;
  /** An option that needs a right, e.g. everyone's tasks only with "tasks: all". */
  optionRights?: Readonly<Record<string, RightRef>>;
};
export type MultiSetting = {
  key: string;
  kind: "multi";
  options: readonly string[];
  default: readonly string[];
  min: number;
  max: number;
};
/** One of the account's notes. */
export type NoteSetting = { key: string; kind: "note" };
export type WidgetSetting = ChoiceSetting | MultiSetting | NoteSetting;

export type WidgetMeta = {
  key: string;
  category: WidgetCategory;
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  requires: WidgetRequirement;
  settings: readonly WidgetSetting[];
  /** "Open section" of the detail. */
  href: string;
  /** False: the widget is all there is (its own buttons), a tap opens nothing. */
  detail?: false;
};

/** Quick actions a widget can offer; each needs its own right (see access.ts). */
export const QUICK_ACTION_KEYS = [
  "newContact",
  "newDeal",
  "newTask",
  "newEvent",
  "newMilestone",
  "newNote",
  "startTimer",
  "generateContacts",
] as const;
export type QuickActionKey = (typeof QUICK_ACTION_KEYS)[number];

export const QUICK_ACTIONS: Record<
  QuickActionKey,
  { href: string; nav: NavKey; right?: RightRef; ownerOnly?: true }
> = {
  newContact: { href: "/app/kontakty?new=contact", nav: "contacts", right: ["contacts", "create"] },
  newDeal: { href: "/app/pipeline?new=deal", nav: "pipeline", right: ["pipeline", "create"] },
  newTask: { href: "/app/ukoly-crm?new=task", nav: "tasks", right: ["tasks", "create"] },
  newEvent: { href: "/app/kalendar?new=event", nav: "calendar", right: ["calendar", "create"] },
  newMilestone: { href: "/app/milniky?new=milestone", nav: "milestones", ownerOnly: true },
  newNote: { href: "/app/poznamky?new=note", nav: "notes" },
  startTimer: {
    href: "/app/cold-calling?timer=start",
    nav: "coldCalling",
    right: ["cold_calling", "call"],
  },
  generateContacts: {
    href: "/app/kontakty?new=generate",
    nav: "contacts",
    right: ["contacts", "generate"],
  },
};

const ALL: readonly WidgetSize[] = ["S", "M", "L", "XL"];

export const WIDGETS = [
  {
    key: "today",
    category: "today",
    sizes: ["M", "L", "XL"],
    defaultSize: "L",
    requires: {},
    settings: [],
    href: "/app/ukoly-crm",
  },
  {
    key: "waiting",
    category: "today",
    sizes: ["M", "L", "XL"],
    defaultSize: "M",
    requires: {},
    settings: [],
    href: "/app/planovac?tab=bookings",
    detail: false,
  },
  {
    key: "overdueTasks",
    category: "today",
    sizes: ALL,
    defaultSize: "M",
    requires: { nav: "tasks" },
    settings: [
      {
        key: "scope",
        kind: "choice",
        options: ["mine", "all"],
        default: "mine",
        optionRights: { all: ["tasks", "view_all"] },
      },
    ],
    href: "/app/ukoly-crm?due=overdue&status=open",
  },
  {
    key: "meetings",
    category: "today",
    sizes: ["S", "M", "L"],
    defaultSize: "M",
    requires: { nav: "calendar", rights: [["calendar", "view"]] },
    settings: [{ key: "days", kind: "choice", options: ["7", "14", "30"], default: "7" }],
    href: "/app/kalendar",
  },
  {
    key: "calendarWeek",
    category: "today",
    sizes: ["M", "L", "XL"],
    defaultSize: "XL",
    requires: { nav: "calendar", rights: [["calendar", "view"]] },
    settings: [],
    href: "/app/kalendar",
  },
  {
    key: "tasksDone",
    category: "progress",
    sizes: ["S", "M", "L"],
    defaultSize: "S",
    requires: { nav: "milestones", rights: [["milestones", "view"]] },
    settings: [],
    href: "/app/milniky",
  },
  {
    key: "pipeline",
    category: "sales",
    sizes: ALL,
    defaultSize: "M",
    requires: { nav: "pipeline", rights: [["pipeline", "view"]] },
    settings: [
      {
        key: "measure",
        kind: "choice",
        options: ["value", "count"],
        default: "value",
        optionRights: { value: ["pipeline", "see_amounts"] },
      },
    ],
    href: "/app/pipeline",
  },
  {
    key: "onFire",
    category: "sales",
    sizes: ["M", "L", "XL"],
    defaultSize: "XL",
    requires: { nav: "pipeline", rights: [["pipeline", "view"]] },
    settings: [],
    href: "/app/pipeline",
    detail: false,
  },
  {
    key: "winRate",
    category: "sales",
    sizes: ["S", "M", "L"],
    defaultSize: "S",
    requires: { nav: "pipeline", rights: [["pipeline", "view"]] },
    settings: [],
    href: "/app/pipeline",
  },
  {
    key: "newContacts",
    category: "sales",
    sizes: ["S", "M", "L"],
    defaultSize: "S",
    requires: {
      nav: "contacts",
      anyRight: [
        ["contacts", "view"],
        ["cold_calling", "view"],
      ],
    },
    settings: [],
    href: "/app/kontakty",
  },
  {
    key: "coldCalling",
    category: "sales",
    sizes: ["S", "M", "L"],
    defaultSize: "S",
    requires: { nav: "coldCalling", rights: [["cold_calling", "view"]] },
    settings: [],
    href: "/app/cold-calling",
  },
  {
    key: "bookings",
    category: "sales",
    sizes: ["S", "M", "L"],
    defaultSize: "M",
    requires: { nav: "scheduler", rights: [["scheduler", "view"]] },
    settings: [],
    href: "/app/planovac?tab=bookings",
  },
  {
    key: "financeMonth",
    category: "money",
    sizes: ALL,
    defaultSize: "S",
    requires: {
      nav: "finance",
      rights: [
        ["finance", "view"],
        ["finance", "summaries"],
      ],
    },
    settings: [],
    href: "/app/finance",
  },
  {
    key: "capital",
    category: "money",
    sizes: ["M", "L", "XL"],
    defaultSize: "L",
    requires: {
      nav: "finance",
      rights: [
        ["finance", "view"],
        ["finance", "summaries"],
      ],
    },
    settings: [],
    href: "/app/finance?tab=overview",
  },
  {
    key: "overdueInvoices",
    category: "money",
    sizes: ["S", "M", "L"],
    defaultSize: "S",
    requires: { nav: "finance", rights: [["invoices", "view"]] },
    settings: [],
    href: "/app/finance?tab=invoices",
  },
  {
    key: "rewards",
    category: "money",
    sizes: ["S", "M", "L"],
    defaultSize: "M",
    requires: {},
    settings: [],
    href: "/app/firma?tab=rewards",
  },
  {
    key: "workTimer",
    category: "team",
    sizes: ["M", "L"],
    defaultSize: "M",
    requires: { role: "worker" },
    settings: [],
    href: "/app/odmeny",
    detail: false,
  },
  {
    key: "team",
    category: "team",
    sizes: ["M", "L", "XL"],
    defaultSize: "L",
    requires: { nav: "workers" },
    settings: [],
    href: "/app/firma",
  },
  {
    key: "activity",
    category: "team",
    sizes: ["M", "L", "XL"],
    defaultSize: "L",
    // The company's activity log (28.7): everyone sees whom the database shows them.
    requires: {},
    settings: [],
    href: "/app/firma?tab=activity",
  },
  {
    key: "milestones",
    category: "progress",
    sizes: ["S", "M", "L"],
    defaultSize: "M",
    requires: { nav: "milestones", rights: [["milestones", "view"]] },
    settings: [],
    href: "/app/milniky",
  },
  {
    key: "level",
    category: "progress",
    sizes: ["S", "M"],
    defaultSize: "S",
    requires: { role: "owner", playing: true },
    settings: [],
    href: "/app/nastaveni/hra",
  },
  {
    key: "grady",
    category: "tools",
    sizes: ["M", "L"],
    defaultSize: "M",
    requires: {},
    settings: [],
    href: "/app/nastaveni/grady",
  },
  {
    key: "pinnedNote",
    category: "tools",
    sizes: ["S", "M", "L"],
    defaultSize: "M",
    requires: { nav: "notes" },
    settings: [{ key: "note", kind: "note" }],
    href: "/app/poznamky",
  },
  {
    key: "quickActions",
    category: "tools",
    sizes: ["S", "M", "L"],
    defaultSize: "M",
    requires: {},
    settings: [
      {
        key: "actions",
        kind: "multi",
        options: QUICK_ACTION_KEYS,
        default: ["newContact", "newDeal", "newTask", "newEvent"],
        min: 1,
        max: 8,
      },
      // "hidden": only the icons; the name stays as the tooltip and for screen readers.
      { key: "labels", kind: "choice", options: ["show", "hidden"], default: "show" },
    ],
    href: "/app",
    detail: false,
  },
  {
    key: "satisfaction",
    category: "tools",
    sizes: ["M", "L"],
    defaultSize: "M",
    requires: {},
    settings: [],
    href: "/app",
    detail: false,
  },
] as const satisfies readonly WidgetMeta[];

export type WidgetKey = (typeof WIDGETS)[number]["key"];
export const WIDGET_KEYS = WIDGETS.map((widget) => widget.key) as unknown as readonly [
  WidgetKey,
  ...WidgetKey[],
];

const BY_KEY = new Map<string, WidgetMeta>(WIDGETS.map((widget) => [widget.key, widget]));

export function widgetMeta(key: string): WidgetMeta | undefined {
  return BY_KEY.get(key);
}

export function isWidgetKey(value: unknown): value is WidgetKey {
  return typeof value === "string" && BY_KEY.has(value);
}

/** The value of a setting, or its default when missing or not one of the options. */
export function settingValue(meta: WidgetMeta, key: string, settings: Record<string, unknown>) {
  const def = meta.settings.find((entry) => entry.key === key);
  if (!def) return undefined;
  const value = settings[key];
  if (def.kind === "choice") {
    return typeof value === "string" && def.options.includes(value) ? value : def.default;
  }
  if (def.kind === "multi") {
    if (!Array.isArray(value)) return [...def.default];
    const kept = def.options.filter((option) => value.includes(option));
    return kept.length >= def.min ? kept.slice(0, def.max) : [...def.default];
  }
  return typeof value === "string" ? value : null;
}
