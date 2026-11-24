import type { WidgetSize } from "./grid";

/**
 * What every widget is to the shared board (28.5, shared since 29.2): the
 * key, its category, the sizes that make sense, its settings and where its
 * detail leads. The app's dashboard and the administration's overview each
 * have their own catalog of these (with their own rules of who may use
 * which), and hand it to the board as a widget system (system.tsx).
 */

/** A right or a power an option of a setting needs; what it means is the system's. */
export type OptionRight = readonly [string, string];

export type ChoiceSetting = {
  key: string;
  kind: "choice";
  options: readonly string[];
  default: string;
  /** An option that needs a right, e.g. everyone's tasks only with "tasks: all". */
  optionRights?: Readonly<Record<string, OptionRight>>;
};
export type MultiSetting = {
  key: string;
  kind: "multi";
  options: readonly string[];
  default: readonly string[];
  min: number;
  max: number;
};
/** One of the account's notes (the app's pinned note). */
export type NoteSetting = { key: string; kind: "note" };
export type WidgetSetting = ChoiceSetting | MultiSetting | NoteSetting;

export type CoreWidgetMeta = {
  key: string;
  category: string;
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  settings: readonly WidgetSetting[];
  /** "Open section" of the detail. */
  href: string;
  /** False: the widget is all there is (its own buttons), a tap opens nothing. */
  detail?: false;
};

/** The value of a setting, or its default when missing or not one of the options. */
export function settingValue(
  meta: Pick<CoreWidgetMeta, "settings">,
  key: string,
  settings: Record<string, unknown>,
) {
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
