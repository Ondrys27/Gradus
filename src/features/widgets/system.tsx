"use client";

import { createContext, use, useContext, type ComponentType, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { Tone } from "@/components/ui/tone";
import type { LayoutItem, WidgetSize } from "./grid";
import type { WidgetDef } from "./kit";
import type { ChoiceSetting, CoreWidgetMeta, MultiSetting, WidgetSetting } from "./meta";

/**
 * One kind of board of widgets (29.2): the app's dashboard or the
 * administration's overview. The shared board (grid, editing, gallery,
 * detail, saving and tabs) knows nothing of either; everything that differs
 * comes in here: the catalog, who may use which widget, the names, icons and
 * colours, the code of each widget and what the board reports to analytics.
 * A host builds it in a hook (it closes over the account's rights and the
 * translations) and hands it to WidgetBoard, which provides it to every
 * frame, the gallery and the detail.
 */

/** What the board reports while it is shaped; the app turns these into its dashboard_* events. */
export type BoardEvent =
  | { type: "edit_started"; via: "button" | "long_press"; template?: string }
  | { type: "widget_added"; widget: string; size: WidgetSize; count: number }
  | { type: "widget_opened"; widget: string; size: WidgetSize }
  | { type: "widget_removed"; widget: string }
  | { type: "widget_resized"; widget: string; size: WidgetSize }
  | { type: "widget_moved"; widget: string }
  | { type: "widget_settings_saved"; widget: string };

export type CustomSettingProps = {
  widget: string;
  setting: WidgetSetting;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
};

export type WidgetSystem = {
  /** Several boards on one page and their caches stay apart by it. */
  id: string;
  meta: (key: string) => CoreWidgetMeta | undefined;
  appearance: (key: string) => { icon: LucideIcon; tone: Tone };
  /** The widget's code; the same promise every time for the same key. */
  load: (key: string) => Promise<WidgetDef>;
  name: (key: string) => string;
  description: (key: string) => string;
  /** The categories of the gallery, in order, and their names. */
  categories: readonly string[];
  categoryName: (category: string) => string;
  /** `<widget>.settings.<setting>.<part>`: the label of a setting (`label`) or of an option. */
  settingLabel: (widget: string, setting: string, part: string) => string;
  /** Widgets the account may place, in catalog order. */
  available: readonly CoreWidgetMeta[];
  /** The items of a layout the account may see; the rest are left out quietly. */
  visible: (items: readonly LayoutItem[]) => LayoutItem[];
  /** The settings a widget works with: stored or default, a choice not allowed replaced. */
  effective: (meta: CoreWidgetMeta, stored: Record<string, unknown>) => Record<string, unknown>;
  /** Options of a choice the account may pick. */
  choiceOptions: (setting: ChoiceSetting) => readonly string[];
  /** Options of a multiple choice the account may pick, and their names. */
  multiOptions: (widget: string, setting: MultiSetting) => readonly string[];
  multiOptionLabel: (widget: string, setting: MultiSetting, option: string) => string;
  /** A field for a kind of setting the board does not know (the app's note). */
  CustomSetting?: ComponentType<CustomSettingProps>;
  /** Suggested widgets for the top of the gallery. */
  recommend?: (available: readonly CoreWidgetMeta[], placed: readonly string[]) => CoreWidgetMeta[];
  /** The board's own page: the detail offers no "Open section" there. */
  homeHref: string;
  track?: (event: BoardEvent) => void;
};

const WidgetSystemContext = createContext<WidgetSystem | null>(null);

export function WidgetSystemProvider({
  system,
  children,
}: {
  system: WidgetSystem;
  children: ReactNode;
}) {
  return <WidgetSystemContext.Provider value={system}>{children}</WidgetSystemContext.Provider>;
}

export function useWidgetSystem(): WidgetSystem {
  const system = useContext(WidgetSystemContext);
  if (!system) throw new Error("A widget is drawn outside of a WidgetSystemProvider");
  return system;
}

/** Suspends until the widget's code is there (inside a Suspense boundary). */
export function useWidgetDef(key: string): WidgetDef {
  return use(useWidgetSystem().load(key));
}

/** A loader that keeps one promise per key and tries a failed chunk again next time. */
export function cachedLoader(
  loaders: Readonly<Record<string, () => Promise<WidgetDef>>>,
): (key: string) => Promise<WidgetDef> {
  const loaded = new Map<string, Promise<WidgetDef>>();
  return (key) => {
    let promise = loaded.get(key);
    if (!promise) {
      const loader = loaders[key];
      promise = (loader ? loader() : Promise.reject(new Error(`Unknown widget ${key}`))).catch(
        (error: unknown) => {
          // A failed chunk (offline) is tried again on the next render.
          loaded.delete(key);
          throw error;
        },
      );
      loaded.set(key, promise);
    }
    return promise;
  };
}
