import type { WidgetSize } from "@/features/widgets/grid";
import type { ChoiceSetting, CoreWidgetMeta } from "@/features/widgets/meta";
import { ADMIN_PATH } from "../access";
import { adminCan, type AdminActor, type AdminPower } from "../roles";
import { ADMIN_PERIODS } from "../view-state";

/**
 * The widgets of the administration's overview (29.2), without React: the
 * key, the group, the sizes, who may use it and its settings. Names and
 * descriptions are in `admin.widgets.<key>`; the components in registry.tsx,
 * the data in server/widget-data.ts (always through the admin guard).
 *
 * A widget the administrator may not use (a limited admin and the Money
 * widgets) does not exist for them: not in the gallery, left out of a layout
 * quietly, and its data route answers 404.
 */

export const ADMIN_WIDGET_CATEGORIES = [
  "operations",
  "people",
  "money",
  "ai",
  "product",
  "management",
] as const;
export type AdminWidgetCategory = (typeof ADMIN_WIDGET_CATEGORIES)[number];

/**
 * A widget's own period ("always today"); `bar` follows the period of the
 * top bar. Custom ranges stay the bar's.
 */
export const WIDGET_PERIODS = ["bar", ...ADMIN_PERIODS.filter((period) => period !== "custom")] as const;
export type WidgetPeriod = (typeof WIDGET_PERIODS)[number];

export const PERIOD_SETTING: ChoiceSetting = {
  key: "period",
  kind: "choice",
  options: WIDGET_PERIODS,
  default: "bar",
};

export type AdminWidgetMeta = CoreWidgetMeta & {
  category: AdminWidgetCategory;
  /** Only who holds this power (roles.ts); everyone else does not have the widget. */
  power?: AdminPower;
  /** Refreshes itself every minute while the tab is visible (errors, health, sign-ups, revenue). */
  live?: true;
  /** Reads the period (of the bar or its own); widgets of a state now do not. */
  period?: true;
};

const P = ADMIN_PATH;
const withPeriod = { settings: [PERIOD_SETTING], period: true } as const;
const noSettings = { settings: [] } as const;

type Entry = Omit<AdminWidgetMeta, "settings"> & { settings: readonly ChoiceSetting[] };

export const ADMIN_WIDGETS = [
  // --- Operations -----------------------------------------------------------
  { key: "errors", category: "operations", sizes: ["M", "L", "XL"], defaultSize: "L", live: true, href: `${P}/chyby`, ...withPeriod },
  { key: "health", category: "operations", sizes: ["S", "M", "L"], defaultSize: "M", live: true, href: `${P}/zdravi`, ...noSettings },
  { key: "deploy", category: "operations", sizes: ["S", "M"], defaultSize: "M", href: `${P}/chyby?latest=1`, ...noSettings },
  { key: "reports", category: "operations", sizes: ["S", "M", "L"], defaultSize: "M", href: `${P}/zpetna-vazba?tab=reports`, ...noSettings },
  // E-mails today and this month against Resend's plan (30.1).
  { key: "emails", category: "operations", sizes: ["S", "M", "L"], defaultSize: "M", href: `${P}/upozorneni`, ...noSettings },
  { key: "latency", category: "operations", sizes: ["S", "M", "L"], defaultSize: "M", href: `${P}/zdravi`, ...withPeriod },
  // --- People ---------------------------------------------------------------
  { key: "newUsers", category: "people", sizes: ["S", "M", "L"], defaultSize: "M", live: true, href: `${P}/rust`, ...withPeriod },
  { key: "activeUsers", category: "people", sizes: ["M", "L", "XL"], defaultSize: "M", href: `${P}/rust`, ...withPeriod },
  { key: "funnel", category: "people", sizes: ["M", "L"], defaultSize: "L", href: `${P}/aktivace`, ...withPeriod },
  { key: "retention", category: "people", sizes: ["S", "M", "L"], defaultSize: "M", href: `${P}/retence`, ...withPeriod },
  { key: "atRisk", category: "people", sizes: ["S", "M", "L"], defaultSize: "M", href: `${P}/uzivatele`, ...noSettings },
  { key: "trialsEnding", category: "people", sizes: ["S", "M"], defaultSize: "S", href: `${P}/naklady`, ...noSettings },
  { key: "countries", category: "people", sizes: ["M", "L"], defaultSize: "M", href: `${P}/rust`, ...withPeriod },
  { key: "recentSignups", category: "people", sizes: ["M", "L"], defaultSize: "L", href: `${P}/uzivatele?sort=signup`, ...noSettings },
  // --- Money (never for a limited admin) -----------------------------------
  { key: "revenue", category: "money", sizes: ["M", "L", "XL"], defaultSize: "L", live: true, power: "viewMoney", href: `${P}/naklady`, ...withPeriod },
  { key: "payingByPlan", category: "money", sizes: ["S", "M", "L"], defaultSize: "M", power: "viewMoney", href: `${P}/tarify`, ...noSettings },
  { key: "subscriptions", category: "money", sizes: ["S", "M", "L"], defaultSize: "M", power: "viewMoney", href: `${P}/naklady`, ...withPeriod },
  { key: "failedPayments", category: "money", sizes: ["S", "M"], defaultSize: "S", power: "viewMoney", href: `${P}/naklady`, ...withPeriod },
  { key: "promo", category: "money", sizes: ["S", "M", "L"], defaultSize: "M", power: "viewMoney", href: `${P}/promo-kody`, ...noSettings },
  { key: "margin", category: "money", sizes: ["M", "L"], defaultSize: "M", power: "viewMoney", href: `${P}/naklady`, ...withPeriod },
  // --- AI -------------------------------------------------------------------
  { key: "aiSpend", category: "ai", sizes: ["S", "M", "L"], defaultSize: "M", href: `${P}/ai`, ...noSettings },
  { key: "aiPerUser", category: "ai", sizes: ["S", "M"], defaultSize: "S", href: `${P}/ai`, ...withPeriod },
  { key: "aiTopUsers", category: "ai", sizes: ["M", "L"], defaultSize: "L", href: `${P}/ai`, ...withPeriod },
  { key: "aiByFeature", category: "ai", sizes: ["M", "L"], defaultSize: "L", href: `${P}/ai?tab=models`, ...withPeriod },
  { key: "aiEconomy", category: "ai", sizes: ["S", "M"], defaultSize: "S", href: `${P}/ai?tab=models`, ...noSettings },
  { key: "aiSavings", category: "ai", sizes: ["M", "L"], defaultSize: "M", href: `${P}/ai?tab=models`, ...noSettings },
  // --- Product --------------------------------------------------------------
  { key: "topFeatures", category: "product", sizes: ["M", "L"], defaultSize: "L", href: `${P}/funkce`, ...withPeriod },
  { key: "tutorial", category: "product", sizes: ["S", "M", "L"], defaultSize: "M", href: `${P}/aktivace`, ...withPeriod },
  { key: "game", category: "product", sizes: ["M", "L"], defaultSize: "M", href: `${P}/hra`, ...withPeriod },
  { key: "scheduler", category: "product", sizes: ["S", "M"], defaultSize: "S", href: `${P}/pruzkumnik`, ...withPeriod },
  { key: "mcp", category: "product", sizes: ["S", "M"], defaultSize: "S", href: `${P}/pruzkumnik`, ...withPeriod },
  { key: "satisfaction", category: "product", sizes: ["S", "M", "L"], defaultSize: "M", href: `${P}/zpetna-vazba`, ...withPeriod },
  // --- Management -----------------------------------------------------------
  { key: "audit", category: "management", sizes: ["M", "L"], defaultSize: "L", href: `${P}/audit`, ...noSettings },
  { key: "waiting", category: "management", sizes: ["S", "M", "L"], defaultSize: "M", href: P, detail: false, ...noSettings },
  { key: "quickActions", category: "management", sizes: ["S", "M"], defaultSize: "M", href: P, detail: false, ...noSettings },
] as const satisfies readonly Entry[];

export type AdminWidgetKey = (typeof ADMIN_WIDGETS)[number]["key"];
export const ADMIN_WIDGET_KEYS = ADMIN_WIDGETS.map((widget) => widget.key) as AdminWidgetKey[];

const BY_KEY = new Map<string, AdminWidgetMeta>(
  ADMIN_WIDGETS.map((widget) => [widget.key, widget as AdminWidgetMeta]),
);

export function adminWidgetMeta(key: string): AdminWidgetMeta | undefined {
  return BY_KEY.get(key);
}

export function isAdminWidgetKey(value: unknown): value is AdminWidgetKey {
  return typeof value === "string" && BY_KEY.has(value);
}

/** The widget exists for this administrator: known, and its power (if any) is theirs. */
export function adminWidgetAllowed(key: string, actor: AdminActor | null | undefined): boolean {
  const meta = BY_KEY.get(key);
  if (!meta || !actor) return false;
  return !meta.power || adminCan(actor, meta.power);
}

/** What the gallery offers this administrator, in catalog order. */
export function availableAdminWidgets(actor: AdminActor): AdminWidgetMeta[] {
  return [...BY_KEY.values()].filter((meta) => adminWidgetAllowed(meta.key, actor));
}

/** The items of a layout this administrator may see, in a size the widget has. */
export function visibleAdminItems<T extends { widget: string; size: WidgetSize }>(
  items: readonly T[],
  actor: AdminActor,
): T[] {
  return items.filter((item) => {
    const meta = BY_KEY.get(item.widget);
    return Boolean(meta && adminWidgetAllowed(item.widget, actor) && meta.sizes.includes(item.size));
  });
}

/** The keys that refresh every minute (step 29.2: errors, health, new users, revenue). */
export const LIVE_WIDGETS = ADMIN_WIDGETS.filter((widget) => "live" in widget && widget.live).map(
  (widget) => widget.key,
);
