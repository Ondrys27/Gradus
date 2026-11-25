"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { WidgetSystem } from "@/features/widgets/system";
import { settingValue } from "@/features/widgets/meta";
import { ADMIN_PATH } from "../access";
import type { AdminActor } from "../roles";
import { ADMIN_WIDGET_APPEARANCE } from "./appearance";
import {
  ADMIN_WIDGET_CATEGORIES,
  adminWidgetMeta,
  availableAdminWidgets,
  visibleAdminItems,
  type AdminWidgetKey,
} from "./catalog";
import { loadAdminWidget } from "./registry";

/**
 * The administration's overview as a widget system for the shared board
 * (29.2): its own catalog, the administrator's powers (a widget they may not
 * use does not exist for them), the names from `admin.widgets` and no
 * analytics events (the administration is audited, not tracked).
 */
export function useAdminWidgetSystem(actor: AdminActor): WidgetSystem {
  const t = useTranslations("admin.widgets");
  return useMemo(() => {
    const label = (key: string) => t(key as "board.empty");
    return {
      id: "admin",
      meta: adminWidgetMeta,
      appearance: (key) => ADMIN_WIDGET_APPEARANCE[key as AdminWidgetKey],
      load: loadAdminWidget,
      name: (key) => label(`items.${key}.name`),
      description: (key) => label(`items.${key}.description`),
      categories: ADMIN_WIDGET_CATEGORIES,
      categoryName: (category) => label(`categories.${category}`),
      settingLabel: (_widget, setting, part) => label(`settings.${setting}.${part}`),
      available: availableAdminWidgets(actor),
      visible: (items) => visibleAdminItems(items, actor),
      // Every setting at its stored value or its default (a period no longer offered falls back).
      effective: (meta, stored) =>
        Object.fromEntries(
          meta.settings.map((setting) => [setting.key, settingValue(meta, setting.key, stored)]),
        ),
      choiceOptions: (setting) => setting.options,
      multiOptions: (_widget, setting) => setting.options,
      multiOptionLabel: (_widget, setting, option) => label(`settings.${setting.key}.${option}`),
      homeHref: ADMIN_PATH,
    } satisfies WidgetSystem;
  }, [actor, t]);
}
