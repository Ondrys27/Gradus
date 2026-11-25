import { parseAdminView, serializeAdminView, type AdminView } from "../view-state";
import { WIDGET_PERIODS, type WidgetPeriod } from "./catalog";

/**
 * The view a widget's numbers are read for (29.2): the top bar's period,
 * comparison, filters and internal accounts, unless the widget has its own
 * period in its settings ("always today"); then only the period is its own
 * and the filters stay the bar's. Pure, shared by the browser (the query of
 * the widget's data) and the server (which parses it again).
 */

export function isWidgetPeriod(value: unknown): value is WidgetPeriod {
  return typeof value === "string" && (WIDGET_PERIODS as readonly string[]).includes(value);
}

/** The bar's view with the widget's own period over it. */
export function widgetView(bar: AdminView, period: unknown): AdminView {
  if (!isWidgetPeriod(period) || period === "bar") return bar;
  return { ...bar, period, from: null, to: null };
}

/** The query string of a widget's data request: the view as the address would carry it. */
export function widgetViewQuery(barSearch: string, period: unknown): string {
  const bar = parseAdminView(new URLSearchParams(barSearch.replace(/^\?/, "")));
  return serializeAdminView(widgetView(bar, period)).toString();
}
