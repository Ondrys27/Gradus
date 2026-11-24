"use client";

import {
  ActivityIcon,
  BanknoteIcon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  ClockAlertIcon,
  ClockIcon,
  CoinsIcon,
  FileWarningIcon,
  FlagIcon,
  FlameIcon,
  InboxIcon,
  KanbanSquareIcon,
  LineChartIcon,
  ListChecksIcon,
  NotebookPenIcon,
  SmileIcon,
  SparklesIcon,
  SunIcon,
  TargetIcon,
  TimerIcon,
  TrophyIcon,
  UserPlusIcon,
  UsersRoundIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "@/components/ui/tone";
import type { WidgetCategory, WidgetKey } from "./catalog";

/**
 * One accent per section (28.6): every widget of a section wears the same
 * colour in its icon, its charts and its marks, so the board reads by
 * section at a glance. Pink is a status, not a section: the widgets about
 * what is wrong (overdue tasks, invoices past due, what is on fire) keep it.
 * Gold stays the colour of rewards and XP (the design tokens say so).
 */
export const CATEGORY_TONE: Record<WidgetCategory, Tone> = {
  today: "teal",
  sales: "violet",
  money: "green",
  team: "teal",
  progress: "gold",
  tools: "violet",
};

/** How each widget looks in its title and in the gallery: its icon and its accent. */
export const WIDGET_APPEARANCE: Record<WidgetKey, { icon: LucideIcon; tone: Tone }> = {
  today: { icon: SunIcon, tone: "teal" },
  waiting: { icon: InboxIcon, tone: "teal" },
  overdueTasks: { icon: ClockAlertIcon, tone: "pink" },
  meetings: { icon: CalendarDaysIcon, tone: "teal" },
  calendarWeek: { icon: CalendarRangeIcon, tone: "teal" },
  tasksDone: { icon: ListChecksIcon, tone: "gold" },
  pipeline: { icon: KanbanSquareIcon, tone: "violet" },
  onFire: { icon: FlameIcon, tone: "pink" },
  winRate: { icon: TargetIcon, tone: "violet" },
  newContacts: { icon: UserPlusIcon, tone: "violet" },
  coldCalling: { icon: TimerIcon, tone: "violet" },
  bookings: { icon: CalendarCheckIcon, tone: "violet" },
  financeMonth: { icon: BanknoteIcon, tone: "green" },
  capital: { icon: LineChartIcon, tone: "green" },
  overdueInvoices: { icon: FileWarningIcon, tone: "pink" },
  rewards: { icon: CoinsIcon, tone: "gold" },
  workTimer: { icon: ClockIcon, tone: "teal" },
  team: { icon: UsersRoundIcon, tone: "teal" },
  activity: { icon: ActivityIcon, tone: "teal" },
  milestones: { icon: FlagIcon, tone: "gold" },
  level: { icon: TrophyIcon, tone: "gold" },
  grady: { icon: SparklesIcon, tone: "violet" },
  pinnedNote: { icon: NotebookPenIcon, tone: "violet" },
  quickActions: { icon: ZapIcon, tone: "violet" },
  satisfaction: { icon: SmileIcon, tone: "violet" },
};
