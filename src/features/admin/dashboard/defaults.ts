import { withPositions, type LayoutItem, type WidgetSize } from "@/features/widgets/grid";
import type { AdminWidgetKey } from "./catalog";

/**
 * The overview an administrator starts with (29.2) and the tabs ready to be
 * added with one click. Widgets an administrator may not use (the Money ones
 * for a limited admin) drop out when the board is shown, so one list serves
 * everyone. Ids are fixed: the same default is the same layout every time.
 */

type Entry = readonly [AdminWidgetKey, WidgetSize];

function build(prefix: string, entries: readonly Entry[]): LayoutItem[] {
  return withPositions(
    entries.map(([widget, size], index) => ({
      id: `${prefix}${index + 1}`,
      widget,
      size,
      x: 0,
      y: 0,
      settings: {},
    })),
  );
}

/** The main tab "Overview". */
export const ADMIN_DEFAULT_ENTRIES: readonly Entry[] = [
  ["errors", "L"],
  ["health", "M"],
  ["newUsers", "M"],
  ["activeUsers", "M"],
  ["revenue", "L"],
  ["aiSpend", "M"],
  ["margin", "M"],
  ["reports", "M"],
  ["waiting", "M"],
  ["trialsEnding", "S"],
  ["failedPayments", "S"],
];

export function adminSystemDefault(): LayoutItem[] {
  return build("a", ADMIN_DEFAULT_ENTRIES);
}

export const ADMIN_TEMPLATES = ["operations", "money", "ai", "people"] as const;
export type AdminTemplate = (typeof ADMIN_TEMPLATES)[number];

const TEMPLATE_ENTRIES: Record<AdminTemplate, readonly Entry[]> = {
  operations: [
    ["errors", "XL"],
    ["health", "L"],
    ["latency", "L"],
    ["deploy", "M"],
    ["reports", "M"],
    ["audit", "L"],
  ],
  money: [
    ["revenue", "XL"],
    ["payingByPlan", "M"],
    ["subscriptions", "M"],
    ["margin", "L"],
    ["promo", "M"],
    ["failedPayments", "S"],
    ["trialsEnding", "S"],
  ],
  ai: [
    ["aiSpend", "L"],
    ["aiByFeature", "L"],
    ["aiTopUsers", "L"],
    ["aiPerUser", "S"],
    ["aiEconomy", "S"],
    ["aiSavings", "M"],
  ],
  people: [
    ["newUsers", "L"],
    ["activeUsers", "XL"],
    ["funnel", "L"],
    ["retention", "M"],
    ["atRisk", "M"],
    ["countries", "M"],
    ["recentSignups", "L"],
  ],
};

/** A ready tab's widgets; the Money tab only for who may see money (the caller decides). */
export function adminTemplate(template: AdminTemplate): LayoutItem[] {
  return build(template.slice(0, 2), TEMPLATE_ENTRIES[template]);
}
