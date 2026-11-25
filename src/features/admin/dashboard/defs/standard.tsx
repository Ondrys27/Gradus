"use client";

import type { ComponentType } from "react";
import { defineWidget, type WidgetDef } from "@/features/widgets/kit";
import type { AdminWidgetData } from "../data";
import { useAdminWidgetData } from "../use-widget-data";
import { AiEconomyView, AiSpendView, DeployView, StandardDetail, StandardView, type StandardViewProps } from "../views";

/** Widgets with a composition of their own over the same data (views.tsx); the rest use the standard one. */
const VIEWS: Record<string, ComponentType<StandardViewProps>> = {
  aiSpend: AiSpendView,
  aiEconomy: AiEconomyView,
  deploy: DeployView,
};

/** A widget of the overview drawn by the shared anatomy (views.tsx) from its data route. */
export function standardWidget(key: string): WidgetDef {
  const View = VIEWS[key] ?? StandardView;
  return defineWidget<AdminWidgetData>({
    key,
    useData: (settings) => useAdminWidgetData(key, settings),
    View: (props) => <View {...props} widgetKey={key} />,
    Detail: StandardDetail,
  });
}
