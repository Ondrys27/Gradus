"use client";

import type { WidgetKey } from "./catalog";
import type { WidgetDef } from "@/features/widgets/kit";
import { cachedLoader } from "@/features/widgets/system";

/**
 * Every widget's components and data (28.5), by key, loaded only when a
 * widget of the kind is on the board, in the gallery or opened: the code of a
 * widget nobody placed never reaches the browser. What a widget is and who may
 * use it is in catalog.ts; its icon and colour in appearance.ts.
 */
const LOADERS: Record<WidgetKey, () => Promise<WidgetDef>> = {
  today: () => import("./defs/today").then((module) => module.todayWidget),
  waiting: () => import("./defs/today").then((module) => module.waitingWidget),
  overdueTasks: () => import("./defs/today").then((module) => module.overdueTasksWidget),
  meetings: () => import("./defs/today").then((module) => module.meetingsWidget),
  calendarWeek: () => import("./defs/today").then((module) => module.calendarWeekWidget),
  tasksDone: () => import("./defs/today").then((module) => module.tasksDoneWidget),
  pipeline: () => import("./defs/sales").then((module) => module.pipelineWidget),
  onFire: () => import("./defs/sales").then((module) => module.onFireWidget),
  winRate: () => import("./defs/sales").then((module) => module.winRateWidget),
  newContacts: () => import("./defs/sales").then((module) => module.newContactsWidget),
  coldCalling: () => import("./defs/sales").then((module) => module.coldCallingWidget),
  bookings: () => import("./defs/sales").then((module) => module.bookingsWidget),
  financeMonth: () => import("./defs/money").then((module) => module.financeMonthWidget),
  capital: () => import("./defs/money").then((module) => module.capitalWidget),
  overdueInvoices: () => import("./defs/money").then((module) => module.overdueInvoicesWidget),
  rewards: () => import("./defs/money").then((module) => module.rewardsWidget),
  workTimer: () => import("./defs/team").then((module) => module.workTimerWidget),
  team: () => import("./defs/team").then((module) => module.teamWidget),
  activity: () => import("./defs/team").then((module) => module.activityWidget),
  milestones: () => import("./defs/progress").then((module) => module.milestonesWidget),
  level: () => import("./defs/progress").then((module) => module.levelWidget),
  grady: () => import("./defs/tools").then((module) => module.gradyWidget),
  pinnedNote: () => import("./defs/tools").then((module) => module.pinnedNoteWidget),
  quickActions: () => import("./defs/tools").then((module) => module.quickActionsWidget),
  satisfaction: () => import("./defs/tools").then((module) => module.satisfactionWidget),
};

/** The widget's definition; the same promise every time, so React can wait on it. */
export const loadWidget: (key: string) => Promise<WidgetDef> = cachedLoader(LOADERS);
