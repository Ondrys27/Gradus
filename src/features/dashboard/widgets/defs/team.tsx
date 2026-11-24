"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays } from "date-fns";
import { ActivityIcon, UsersRoundIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { dayRangeToInstants } from "@/features/calendar/calendar-logic";
import {
  activityHref,
  sentenceKey,
  summaryOf,
  type ActivityRow as ActivityLogRow,
} from "@/features/workers/company/activity";
import { useAssignees } from "@/features/crm-tasks/queries";
import { useToday } from "@/features/dashboard/queries";
import { useCompanyTree } from "@/features/workers/company/queries";
import type { CompanyPerson } from "@/features/workers/company/tree";
import { WorkTimerCard } from "@/features/workers/worker-env/work-timer-card";
import {
  formatDateTime,
  formatNumber,
  formatWeekdayShort,
  isoDateToLocal,
  localToIsoDate,
  todayIsoDate,
  type IsoDate,
} from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import { COMPANY_PATH } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  Actions,
  Bar,
  Columns,
  combine,
  defineWidget,
  Empty,
  Hero,
  LiveNumber,
  READY,
  Row,
  RowList,
  Stack,
  Sub,
  type WidgetQuery,
  type WidgetViewProps,
} from "@/features/widgets/kit";

// ---------------------------------------------------------------------------
// Work timer of a worker (their own time in the company)
// ---------------------------------------------------------------------------

function WorkTimer({ tall = false }: { tall?: boolean }) {
  const { worker } = useSession();
  if (!worker) return null;
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", tall && "justify-center")}>
      <WorkTimerCard workerId={worker.id} bare />
    </div>
  );
}

export const workTimerWidget = defineWidget<true>({
  key: "workTimer",
  useData: () => READY,
  View: ({ size }) => <WorkTimer tall={size === "L"} />,
  Detail: () => <WorkTimer />,
});

// ---------------------------------------------------------------------------
// Team: who has what open (company_tree counts, only the branch a worker sees)
// ---------------------------------------------------------------------------

type TeamData = { people: CompanyPerson[] };

const load = (person: CompanyPerson) => person.openTasks + person.openDeals;

function useTeam(): WidgetQuery<TeamData> {
  const tree = useCompanyTree();
  return combine([tree], () => ({
    people: (tree.data ?? [])
      .filter((person) => person.status === "active")
      .sort((a, b) => load(b) - load(a) || a.name.localeCompare(b.name)),
  }));
}

function PersonRow({ person }: { person: CompanyPerson }) {
  const t = useTranslations("dashboard.widgets.team");
  return (
    <Row
      href={`${COMPANY_PATH}?worker=${person.id}`}
      trail={
        <span className="text-ink-soft">
          {t("load", { tasks: person.openTasks, deals: person.openDeals })}
        </span>
      }
    >
      {person.name}
    </Row>
  );
}

/** One bar per person, against the busiest one. */
function PersonBars({
  people,
  tone,
  columns = false,
}: {
  people: CompanyPerson[];
  tone: WidgetViewProps<TeamData>["tone"];
  columns?: boolean;
}) {
  const t = useTranslations("dashboard.widgets.team");
  const max = Math.max(1, ...people.map(load));
  return (
    <ul className={cn("flex flex-col gap-2.5", columns && "@3xl:grid @3xl:grid-cols-2 @3xl:gap-x-6")}>
      {people.map((person) => (
        <Bar
          key={person.id}
          label={person.name}
          value={t("load", { tasks: person.openTasks, deals: person.openDeals })}
          ratio={load(person) / max}
          tone={tone}
          href={`${COMPANY_PATH}?worker=${person.id}`}
        />
      ))}
    </ul>
  );
}

function TeamView({ size, data, tone }: WidgetViewProps<TeamData>) {
  const t = useTranslations("dashboard.widgets.team");
  const { worker } = useSession();
  const { people } = data;

  if (people.length === 0) {
    return (
      <Empty
        icon={UsersRoundIcon}
        tone={tone}
        title={t("emptyTitle")}
        hint={size === "M" ? undefined : t("emptyHint")}
        action={{ label: t("invite"), href: COMPANY_PATH }}
        compact
      />
    );
  }

  const busiest = people[0];
  const hero = (heroSize: "lg" | "md") => (
    <Hero size={heroSize} unit={t("people", { count: people.length })}>
      <LiveNumber value={people.length} />
    </Hero>
  );
  const sub = <Sub>{t("busiest", { name: busiest.name, count: load(busiest) })}</Sub>;

  if (size === "M") {
    return (
      <Stack>
        {hero("lg")}
        {sub}
      </Stack>
    );
  }

  if (size === "L") {
    return (
      <Stack>
        {hero("md")}
        {sub}
        <PersonBars people={people.slice(0, 5)} tone={tone} />
      </Stack>
    );
  }

  const actions = [{ label: t("openCompany"), href: COMPANY_PATH, primary: true }];
  if (!worker) actions.unshift({ label: t("invite"), href: `${COMPANY_PATH}?tab=people`, primary: false });
  return (
    <Stack>
      <div className="grid min-h-0 flex-1 gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Stack className="flex-none">
          {hero("md")}
          {sub}
        </Stack>
        <PersonBars people={people.slice(0, 8)} tone={tone} columns />
      </div>
      <Actions items={actions} />
    </Stack>
  );
}

export const teamWidget = defineWidget<TeamData>({
  key: "team",
  useData: useTeam,
  View: TeamView,
  Detail: ({ data }) => (
    <RowList>
      {data.people.map((person) => (
        <PersonRow key={person.id} person={person} />
      ))}
    </RowList>
  ),
});

// ---------------------------------------------------------------------------
// Activity in the company: the latest calls, e-mails, meetings and moves of
// contacts over the last two weeks, with who did them. 28.7 brings the full
// activity log; until then the contacts' history (contact_activities) is the
// source, through RLS.
// ---------------------------------------------------------------------------

/** Days the widget looks back (the wide chart), and how many rows that may be. */
const ACTIVITY_DAYS = 14;
/** The rows read for the chart; the database pages the full timeline in Company → Activity. */
const ACTIVITY_LIMIT = 200;

/** One step of the company's activity log (28.7), with its day in the user's zone. */
type ActivityItem = ActivityLogRow & { day: IsoDate };

type ActivityData = { items: ActivityItem[]; names: Map<string, string>; days: IsoDate[] };

function shiftDay(day: IsoDate, delta: number): IsoDate {
  return localToIsoDate(addDays(isoDateToLocal(day), delta));
}

/**
 * Activity in the company: the same log as Company → Activity, as the
 * database shows it to the viewer (the owner everybody, a worker their
 * branch; titles and amounts they may not read are blank).
 */
function useActivity(): WidgetQuery<ActivityData> {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const settings = useFormatSettings();
  const { today, timeZone } = useToday();
  const people = useAssignees();
  const firstDay = shiftDay(today, 1 - ACTIVITY_DAYS);
  const { from, to } = dayRangeToInstants(firstDay, today, timeZone);
  const query = useQuery({
    queryKey: ["activity", user.id, workspaceId, "widget", from],
    queryFn: async (): Promise<ActivityLogRow[]> => {
      const { data, error } = await createClient().rpc("activity_feed", {
        _space: workspaceId,
        _from: from,
        _until: to,
        _limit: ACTIVITY_LIMIT,
      });
      if (error) throw error;
      return data;
    },
  });
  const days = useMemo(
    () => Array.from({ length: ACTIVITY_DAYS }, (_, index) => shiftDay(firstDay, index)),
    [firstDay],
  );
  return combine([query, people], () => ({
    items: query.data!.map((item) => ({
      ...item,
      day: todayIsoDate(settings, new Date(item.created_at)),
    })),
    names: new Map((people.data ?? []).map((person) => [person.userId, person.name])),
    days,
  }));
}

function useActivityLine() {
  const t = useTranslations("dashboard.widgets.activity");
  const tLine = useTranslations("workers.company.activity");
  return (item: ActivityItem, names: Map<string, string>) => {
    const summary = summaryOf(item.summary);
    return tLine(`lines.${sentenceKey(item)}` as never, {
      who: (item.actor_id && names.get(item.actor_id)) || t("someone"),
      title: summary.title ?? summary.customer ?? "none",
      stage: summary.stage ?? "none",
      table: summary.table ?? "none",
      kind: summary.kind ?? "other",
      type: summary.type ?? "other",
    } as never);
  };
}

function ActivityRow({ item, names }: { item: ActivityItem; names: Map<string, string> }) {
  const line = useActivityLine();
  const format = useFormatSettings();
  return (
    <Row
      href={activityHref(item) ?? `${COMPANY_PATH}?tab=activity`}
      lead={formatDateTime(new Date(item.created_at), format)}
    >
      {line(item, names)}
    </Row>
  );
}

function ActivityView({ size, data, tone }: WidgetViewProps<ActivityData>) {
  const t = useTranslations("dashboard.widgets.activity");
  const locale = useLocale();
  const format = useFormatSettings();
  const line = useActivityLine();
  const { items, names, days } = data;

  const perDay = useMemo(() => {
    const counts = new Map(days.map((day) => [day, 0]));
    for (const item of items) counts.set(item.day, (counts.get(item.day) ?? 0) + 1);
    return days.map((day) => counts.get(day) ?? 0);
  }, [items, days]);
  const week = perDay.slice(-7);
  const weekCount = week.reduce((sum, count) => sum + count, 0);
  const latest = items[0];

  if (items.length === 0) {
    return (
      <Empty
        icon={ActivityIcon}
        tone={tone}
        zero={formatNumber(0, {}, format)}
        title={t("weekCount", { count: 0 })}
        hint={t("emptyHint")}
        compact={size === "M"}
      />
    );
  }

  const hero = (heroSize: "lg" | "md") => (
    <Hero size={heroSize} unit={t("weekCount", { count: weekCount })}>
      <LiveNumber value={weekCount} />
    </Hero>
  );
  const last = latest && (
    <Sub>
      {formatDateTime(new Date(latest.created_at), format)} · {line(latest, names)}
    </Sub>
  );

  if (size === "M") {
    return (
      <Stack>
        {hero("lg")}
        {last}
      </Stack>
    );
  }

  if (size === "L") {
    return (
      <Stack>
        {hero("md")}
        <Columns
          values={week}
          tone={tone}
          label={t("chart")}
          current={week.length - 1}
          labels={days.slice(-7).map((day) => formatWeekdayShort(isoDateToLocal(day), locale))}
          height={48}
        />
        <RowList>
          {items.slice(0, 3).map((item) => (
            <ActivityRow key={item.id} item={item} names={names} />
          ))}
        </RowList>
      </Stack>
    );
  }

  return (
    <Stack>
      <div className="grid min-h-0 flex-1 gap-4 @3xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          {hero("md")}
          {last}
          <Columns
            values={perDay}
            tone={tone}
            label={t("chart")}
            current={perDay.length - 1}
            labels={days.map((day) => formatNumber(isoDateToLocal(day).getDate(), {}, format))}
            height={64}
          />
        </div>
        <RowList>
          {items.slice(0, 6).map((item) => (
            <ActivityRow key={item.id} item={item} names={names} />
          ))}
        </RowList>
      </div>
      <Actions
        items={[{ label: t("openActivity"), href: `${COMPANY_PATH}?tab=activity`, primary: true }]}
      />
    </Stack>
  );
}

export const activityWidget = defineWidget<ActivityData>({
  key: "activity",
  useData: useActivity,
  View: ActivityView,
  Detail: ({ data }) => {
    const t = useTranslations("dashboard.widgets.activity");
    const format = useFormatSettings();
    if (data.items.length === 0) {
      return (
        <Empty
          icon={ActivityIcon}
          zero={formatNumber(0, {}, format)}
          title={t("weekCount", { count: 0 })}
          hint={t("emptyHint")}
        />
      );
    }
    return (
      <RowList>
        {data.items.map((item) => (
          <ActivityRow key={item.id} item={item} names={data.names} />
        ))}
      </RowList>
    );
  },
});
