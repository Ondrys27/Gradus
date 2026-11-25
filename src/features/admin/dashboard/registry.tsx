"use client";

import type { WidgetDef } from "@/features/widgets/kit";
import { cachedLoader } from "@/features/widgets/system";
import { ADMIN_WIDGET_KEYS, type AdminWidgetKey } from "./catalog";

/**
 * The code of every widget of the overview (29.2), loaded only when a widget
 * of the kind is on the board, in the gallery or opened. Most draw the shared
 * anatomy from their data route (defs/standard.tsx); Errors has its own
 * detail with the quick change of state, the quick actions are only links.
 */
const standard = (key: AdminWidgetKey) => () =>
  import("./defs/standard").then((module) => module.standardWidget(key));

const LOADERS = Object.fromEntries(
  ADMIN_WIDGET_KEYS.map((key) => [key, standard(key)]),
) as Record<AdminWidgetKey, () => Promise<WidgetDef>>;
LOADERS.errors = () => import("./defs/errors").then((module) => module.errorsWidget);
LOADERS.quickActions = () => import("./defs/quick-actions").then((module) => module.quickActionsWidget);

export const loadAdminWidget: (key: string) => Promise<WidgetDef> = cachedLoader(LOADERS);
