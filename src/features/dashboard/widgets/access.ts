import {
  QUICK_ACTION_KEYS,
  QUICK_ACTIONS,
  settingValue,
  WIDGETS,
  widgetMeta,
  type ChoiceSetting,
  type QuickActionKey,
  type RightRef,
  type WidgetMeta,
} from "./catalog";
import type { LayoutItem } from "@/features/widgets/grid";

/**
 * Which widgets an account may use in the active space. Pure: the caller
 * passes the rights (`can`, the same rule as useCan), the sections open in the
 * menu (not locked in game mode, a worker's by their rights) and the list of
 * widgets the owner let the worker use (null = all they have data for).
 * The database is the real guard: row level security refuses the data of a
 * widget the account has no right to, whatever the layout says.
 */
export type WidgetAccess = {
  role: "owner" | "worker";
  can: (section: string, action: string) => boolean;
  navOpen: ReadonlySet<string>;
  playing: boolean;
  allowList: readonly string[] | null;
};

function holds(access: WidgetAccess, [section, action]: RightRef): boolean {
  return access.can(section, action);
}

/** The widget's data is the account's to see here (without the owner's list). */
export function hasWidgetData(meta: WidgetMeta, access: WidgetAccess): boolean {
  const { requires } = meta;
  if (requires.role && requires.role !== access.role) return false;
  if (requires.playing && !access.playing) return false;
  if (requires.nav && !access.navOpen.has(requires.nav)) return false;
  if (requires.rights && !requires.rights.every((right) => holds(access, right))) return false;
  if (requires.anyRight && !requires.anyRight.some((right) => holds(access, right))) return false;
  return true;
}

/** The widget may be used: the account has its data and the owner did not leave it out. */
export function widgetAllowed(key: string, access: WidgetAccess): boolean {
  const meta = widgetMeta(key);
  if (!meta || !hasWidgetData(meta, access)) return false;
  if (access.role === "worker" && access.allowList && !access.allowList.includes(key)) return false;
  return true;
}

/** What the gallery offers, in catalog order. */
export function availableWidgets(access: WidgetAccess): WidgetMeta[] {
  return WIDGETS.filter((meta) => widgetAllowed(meta.key, access));
}

/** The items of a layout the account may see; the rest are left out quietly. */
export function visibleItems(items: readonly LayoutItem[], access: WidgetAccess): LayoutItem[] {
  return items.filter((item) => {
    if (!widgetAllowed(item.widget, access)) return false;
    const meta = widgetMeta(item.widget);
    return Boolean(meta && (meta.sizes as readonly string[]).includes(item.size));
  });
}

/** Options of a choice the account may pick (e.g. everyone's tasks only with "tasks: all"). */
export function allowedOptions(setting: ChoiceSetting, access: WidgetAccess): string[] {
  return setting.options.filter((option) => {
    const right = setting.optionRights?.[option];
    return !right || holds(access, right);
  });
}

/** A choice falls back to the first allowed option when the stored one is not allowed. */
export function effectiveChoice(
  setting: ChoiceSetting,
  value: string,
  access: WidgetAccess,
): string {
  const allowed = allowedOptions(setting, access);
  if (allowed.includes(value)) return value;
  return allowed.includes(setting.default) ? setting.default : (allowed[0] ?? setting.default);
}

/** Quick actions the account may start here. */
export function allowedQuickActions(access: WidgetAccess): QuickActionKey[] {
  return QUICK_ACTION_KEYS.filter((key) => {
    const action = QUICK_ACTIONS[key];
    if (!access.navOpen.has(action.nav)) return false;
    if (action.ownerOnly && access.role !== "owner") return false;
    return !action.right || holds(access, action.right);
  });
}

/** Widgets a worker may be allowed: the ones their rights give data to (for the owner's list). */
export function grantableWidgets(access: Omit<WidgetAccess, "allowList">): WidgetMeta[] {
  return WIDGETS.filter((meta) => hasWidgetData(meta, { ...access, allowList: null }));
}

/**
 * The settings a widget works with: every setting at its stored value or its
 * default, a choice the account may not make replaced by one it may (so a
 * layout copied from the owner never shows a worker everyone's tasks).
 */
export function effectiveSettings(
  meta: WidgetMeta,
  stored: Record<string, unknown>,
  access: WidgetAccess,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const setting of meta.settings) {
    const value = settingValue(meta, setting.key, stored);
    result[setting.key] =
      setting.kind === "choice" ? effectiveChoice(setting, value as string, access) : value;
  }
  return result;
}
