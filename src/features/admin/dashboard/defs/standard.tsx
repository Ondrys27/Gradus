"use client";

import { defineWidget, type WidgetDef } from "@/features/widgets/kit";
import type { AdminWidgetData } from "../data";
import { useAdminWidgetData } from "../use-widget-data";
import { StandardDetail, StandardView } from "../views";

/** A widget of the overview drawn by the shared anatomy (views.tsx) from its data route. */
export function standardWidget(key: string): WidgetDef {
  return defineWidget<AdminWidgetData>({
    key,
    useData: (settings) => useAdminWidgetData(key, settings),
    View: StandardView,
    Detail: StandardDetail,
  });
}
