"use client";

import { useMemo } from "react";
import {
  ArrowRightIcon,
  BanknoteIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CircleCheckBigIcon,
  CirclePlusIcon,
  CircleXIcon,
  FileTextIcon,
  ListPlusIcon,
  TrophyIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/features/account/workspace-queries";
import { ActorAvatar } from "@/features/account/members";
import { eventKind } from "@/features/calendar/calendar-logic";
import { ACTIVITY_ICONS } from "@/features/contacts/activity-panel";
import { useTargetTasks } from "@/features/crm-tasks/queries";
import {
  formatCalendarDate,
  formatCurrency,
  formatDateTime,
  type FormatSettings,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  useDealActivities,
  useDealContacts,
  useDealEvents,
  useDealInvoices,
  useDealMeetings,
} from "./queries";
import { buildDealTimeline, type TimelineEntry } from "./timeline";
import type { Deal } from "./types";

type Tone = "neutral" | "green" | "pink" | "violet" | "gold" | "teal";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-ink-soft",
  green: "text-green",
  pink: "text-pink",
  violet: "text-violet",
  gold: "text-gold",
  teal: "text-teal",
};

/**
 * The deal's history, newest first: made, stage changes with the win or the
 * loss and its reason, value and Close Date changes, contacts added, tasks
 * made and finished (with the note), meetings, e-mails and invoices. Read
 * only; everything comes from where it lives (see buildDealTimeline).
 */
export function DealActivityTimeline({ deal }: { deal: Deal }) {
  const t = useTranslations("pipeline.timeline");
  const settings = useFormatSettings();
  const canCalendar = useCan("calendar", "view");
  const canFinance = useCan("finance", "view");
  const events = useDealEvents(deal.id);
  const contacts = useDealContacts(deal.id);
  const tasks = useTargetTasks("deal", deal.id);
  const meetings = useDealMeetings(deal.id, canCalendar);
  const activities = useDealActivities(deal.id);
  const invoices = useDealInvoices(deal.id, canFinance);

  const pending =
    events.isPending ||
    contacts.isPending ||
    tasks.isPending ||
    activities.isPending ||
    (canCalendar && meetings.isPending) ||
    (canFinance && invoices.isPending);
  // The deal's own log is the core; the other parts drop out quietly when unreadable.
  const failed = events.isError;

  const entries = useMemo(
    () =>
      buildDealTimeline({
        deal,
        events: events.data ?? [],
        contacts: contacts.data ?? [],
        tasks: tasks.data ?? [],
        meetings: meetings.data ?? [],
        activities: activities.data ?? [],
        invoices: invoices.data ?? [],
        timeZone: settings.timeZone,
      }),
    [
      deal,
      events.data,
      contacts.data,
      tasks.data,
      meetings.data,
      activities.data,
      invoices.data,
      settings.timeZone,
    ],
  );

  if (pending) return <Skeleton className="h-24 rounded-xl" />;
  if (failed) return <FormAlert>{t("loadFailed")}</FormAlert>;

  return (
    <ol className="relative flex flex-col">
      {entries.map((entry, index) => (
        <TimelineItem
          key={entry.key}
          entry={entry}
          last={index === entries.length - 1}
          settings={settings}
        />
      ))}
    </ol>
  );
}

function TimelineItem({
  entry,
  last,
  settings,
}: {
  entry: TimelineEntry;
  last: boolean;
  settings: FormatSettings;
}) {
  const t = useTranslations("pipeline.timeline");
  const tActivity = useTranslations("contacts.activity");
  const tCalendar = useTranslations("calendar");
  const dash = t("none");
  const money = (value: number | null, currency: string) =>
    value === null ? dash : formatCurrency(value, currency, settings);
  const date = (value: string | null) => (value ? formatCalendarDate(value, settings) : dash);

  let icon: LucideIcon;
  let tone: Tone = "neutral";
  let title: string;
  let detail: string | null = null;
  let quote: string | null = null;
  let actorId: string | null = null;
  let day: string | null = null;

  switch (entry.kind) {
    case "created":
      icon = CirclePlusIcon;
      tone = "violet";
      title = t("created");
      actorId = entry.actorId;
      break;
    case "stage":
      icon = ArrowRightIcon;
      title = t("stage", { from: entry.from ?? dash, to: entry.to ?? dash });
      actorId = entry.actorId;
      break;
    case "won":
      icon = TrophyIcon;
      tone = "green";
      title = t("won");
      actorId = entry.actorId;
      break;
    case "lost":
      icon = CircleXIcon;
      tone = "pink";
      title = t("lost");
      quote = entry.reason ? t("lostReason", { reason: entry.reason }) : null;
      actorId = entry.actorId;
      break;
    case "value":
      icon = BanknoteIcon;
      title = t("value", {
        from: money(entry.from, entry.fromCurrency),
        to: money(entry.to, entry.toCurrency),
      });
      actorId = entry.actorId;
      break;
    case "closeDate":
      icon = CalendarClockIcon;
      title = t("closeDate", { from: date(entry.from), to: date(entry.to) });
      actorId = entry.actorId;
      break;
    case "contactAdded":
      icon = UserPlusIcon;
      tone = "teal";
      title = t("contactAdded", { name: entry.name ?? t("someContact") });
      detail = entry.note;
      actorId = entry.actorId;
      break;
    case "taskCreated":
      icon = ListPlusIcon;
      title = t("taskCreated");
      detail = entry.task.title;
      actorId = entry.task.created_by;
      break;
    case "taskDone":
      icon = CircleCheckBigIcon;
      tone = "green";
      title = t("taskDone");
      detail = entry.task.title;
      quote = entry.task.completion_note;
      actorId = entry.task.completed_by;
      break;
    case "meeting":
      icon = CalendarCheckIcon;
      tone = "teal";
      title = tCalendar(`kind.${eventKind(entry.meeting.kind)}`);
      detail = entry.meeting.title;
      actorId = entry.meeting.actor_id;
      day = entry.day;
      break;
    case "activity":
      icon = ACTIVITY_ICONS[entry.activity.type];
      title = tActivity(`types.${entry.activity.type}`);
      quote = entry.activity.content;
      break;
    case "invoice":
      icon = FileTextIcon;
      tone = entry.step === "paid" ? "green" : entry.step === "cancelled" ? "pink" : "gold";
      title = t(`invoice.${entry.step}`, { number: entry.invoice.number ?? dash });
      day = entry.day;
      break;
  }

  const Icon = icon;
  const at = new Date(entry.at);
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* The thread between the items; it stops at the last one. */}
      {!last && <span aria-hidden className="absolute top-8 bottom-0 left-3.5 w-px bg-line/70" />}
      <span
        className={cn(
          "relative grid size-7 shrink-0 place-items-center rounded-full border border-line bg-surface",
          TONE_CLASS[tone],
        )}
      >
        <Icon aria-hidden className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="font-medium text-ink [overflow-wrap:anywhere]">{title}</span>
          <ActorAvatar actorId={actorId} className="size-5" />
          <time dateTime={at.toISOString()} className="text-xs text-ink-muted">
            {day ? formatCalendarDate(day, settings) : formatDateTime(at, settings)}
          </time>
        </p>
        {detail && <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{detail}</p>}
        {quote && (
          <p className="border-l-2 border-line pl-2 text-sm whitespace-pre-line text-ink-soft [overflow-wrap:anywhere]">
            {quote}
          </p>
        )}
      </div>
    </li>
  );
}
