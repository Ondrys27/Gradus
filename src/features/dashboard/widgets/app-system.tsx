"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useNavItems } from "@/components/layout/use-nav";
import { track } from "@/lib/analytics/client";
import type { BoardEvent, WidgetSystem } from "@/features/widgets/system";
import {
  allowedOptions,
  allowedQuickActions,
  availableWidgets,
  effectiveSettings,
  visibleItems,
  type WidgetAccess,
} from "./access";
import { WIDGET_APPEARANCE } from "./appearance";
import { WIDGET_CATEGORIES, widgetMeta, type WidgetKey, type WidgetMeta } from "./catalog";
import { NoteSettingField } from "./note-setting";
import { recommendWidgets } from "./recommend";
import { loadWidget } from "./registry";

/** The board's events as the app's dashboard_* analytics events (28.5), unchanged. */
function trackBoard(event: BoardEvent) {
  switch (event.type) {
    case "edit_started":
      track("dashboard_edit_started", {
        via: event.via,
        ...(event.template ? { template: event.template as "space" | "group" | "worker" } : {}),
      });
      return;
    case "widget_added":
      track("dashboard_widget_added", {
        widget: event.widget as WidgetKey,
        size: event.size,
        count: event.count,
      });
      return;
    case "widget_opened":
      track("dashboard_widget_opened", { widget: event.widget as WidgetKey, size: event.size });
      return;
    case "widget_removed":
      track("dashboard_widget_removed", { widget: event.widget as WidgetKey });
      return;
    case "widget_resized":
      track("dashboard_widget_resized", { widget: event.widget as WidgetKey, size: event.size });
      return;
    case "widget_moved":
      track("dashboard_widget_moved", { widget: event.widget as WidgetKey });
      return;
    case "widget_settings_saved":
      track("dashboard_widget_settings_saved", { widget: event.widget as WidgetKey });
      return;
  }
}

/**
 * The app's dashboard as a widget system for the shared board (29.2): its
 * catalog, the account's rights in the active space (access.ts), the names
 * from `dashboard.widgets`, the suggestions by the sections the person has
 * opened and the dashboard_* events.
 */
export function useAppWidgetSystem(access: WidgetAccess): WidgetSystem {
  const t = useTranslations("dashboard.widgets");
  const tCategories = useTranslations("dashboard.board.categories");
  const nav = useNavItems();
  const used = useMemo(
    () =>
      new Set<string>(
        nav.items.filter((item) => !item.locked && !item.fresh).map((item) => item.key),
      ),
    [nav.items],
  );
  return useMemo(() => {
    const available = availableWidgets(access);
    const label = (key: string) => t(key as "today.name");
    return {
      id: "app",
      meta: widgetMeta,
      appearance: (key) => WIDGET_APPEARANCE[key as WidgetKey],
      load: loadWidget,
      name: (key) => label(`${key}.name`),
      description: (key) => label(`${key}.description`),
      categories: WIDGET_CATEGORIES,
      categoryName: (category) => tCategories(category as "today"),
      settingLabel: (widget, setting, part) => label(`${widget}.settings.${setting}.${part}`),
      available,
      visible: (items) => visibleItems(items, access),
      effective: (meta, stored) => effectiveSettings(meta as WidgetMeta, stored, access),
      choiceOptions: (setting) => allowedOptions(setting, access),
      multiOptions: (widget, setting) =>
        widget === "quickActions" ? allowedQuickActions(access) : setting.options,
      multiOptionLabel: (_widget, _setting, option) => label(`quickActions.actions.${option}`),
      CustomSetting: NoteSettingField,
      recommend: (list, placed) => recommendWidgets(list as WidgetMeta[], placed, used),
      homeHref: "/app",
      track: trackBoard,
    } satisfies WidgetSystem;
  }, [access, t, tCategories, used]);
}
