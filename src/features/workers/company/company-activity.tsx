"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ActivityIcon, PlugZapIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { useProfile, useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { useAssignees } from "@/features/crm-tasks/queries";
import { useToday } from "@/features/dashboard/queries";
import { Segmented } from "@/features/finance/segmented";
import { track } from "@/lib/analytics/client";
import { formatDate, formatDateTime, formatPrice, isoDateToLocal } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import {
  ACTIVITY_KINDS,
  ACTIVITY_PERIODS,
  activityFiltersSearch,
  activityHref,
  actorsFor,
  dailyByDay,
  parseActivityFilters,
  periodRange,
  sentenceKey,
  summaryOf,
  type ActivityFilters,
  type ActivityKind,
  type ActivityRow,
} from "./activity";
import { useActivityDaily, useActivityFeed } from "./activity-queries";
import type { CompanyGroup, CompanyPerson } from "./tree";

const ALL = "all";

/**
 * Company → Activity (28.7): a timeline of who did what in the company,
 * filtered by person, group, kind and period, with each person's day in
 * numbers (tasks, deals, calls, meetings). The owner sees everybody, a worker
 * their branch (the whole company with "company: view all"); steps made
 * through Grady or Claude carry their mark.
 */
export function CompanyActivity({
  people,
  groups,
}: {
  people: CompanyPerson[] | undefined;
  groups: CompanyGroup[] | undefined;
}) {
  const t = useTranslations("workers.company.activity");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const filters = useMemo(() => parseActivityFilters(new URLSearchParams(search)), [search]);
  const { today, timeZone } = useToday();
  const range = useMemo(
    () => periodRange(filters.period, today, timeZone),
    [filters.period, today, timeZone],
  );
  const actors = useMemo(() => actorsFor(filters, people ?? []), [filters, people]);
  const names = useNames(people);
  const groupsReady = !filters.group || people !== undefined;

  const feed = useActivityFeed(
    {
      from: range.from,
      until: range.until,
      actors,
      kinds: filters.kind ? [filters.kind] : null,
    },
    groupsReady,
  );
  const daily = useActivityDaily(
    { from: range.from, until: range.until, timeZone, actors },
    groupsReady,
  );

  useEffect(() => {
    track("company_activity_viewed", {
      by_person: filters.person !== null,
      by_group: filters.group !== null,
      by_kind: filters.kind !== null,
      period: filters.period,
    });
  }, [filters.person, filters.group, filters.kind, filters.period]);

  function change(next: Partial<ActivityFilters>) {
    const text = activityFiltersSearch(new URLSearchParams(search), next);
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }

  const rows = feed.data?.pages.flat() ?? [];
  const nobody = actors !== null && actors.length === 0;

  return (
    <div className="flex flex-col gap-5" data-testid="company-activity">
      <Filters
        filters={filters}
        people={people ?? []}
        groups={groups ?? []}
        names={names}
        onChange={change}
      />

      <DailySummary
        loading={daily.isPending && !nobody}
        failed={daily.isError}
        rows={nobody ? [] : (daily.data ?? [])}
        names={names}
      />

      <section className="flex flex-col gap-3" aria-labelledby="company-activity-timeline">
        <h3 id="company-activity-timeline" className="micro-label">
          {t("timeline")}
        </h3>
        {feed.isError ? (
          <FormAlert>{t("loadFailed")}</FormAlert>
        ) : feed.isPending && !nobody ? (
          <div className="flex flex-col gap-2" aria-hidden>
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ActivityIcon />}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        ) : (
          <ol className="flex flex-col divide-y divide-line rounded-card border border-line">
            {rows.map((row) => (
              <TimelineRow key={row.id} row={row} names={names} />
            ))}
          </ol>
        )}
        {feed.hasNextPage && (
          <Button
            type="button"
            variant="outline"
            className="self-center"
            disabled={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
          >
            {t("more")}
          </Button>
        )}
      </section>
    </div>
  );
}

type Names = Map<string, { name: string; avatarUrl: string | null }>;

/** Everyone the viewer may see by account id: the company's people (also ended) and the owner. */
function useNames(people: CompanyPerson[] | undefined): Names {
  const t = useTranslations("workers.company");
  const { user } = useSession();
  const profile = useProfile();
  const workspace = useWorkspace();
  const members = useAssignees();
  return useMemo(() => {
    const map: Names = new Map();
    for (const member of members.data ?? [])
      map.set(member.userId, { name: member.name, avatarUrl: null });
    for (const person of people ?? []) {
      if (person.userId) map.set(person.userId, { name: person.name, avatarUrl: person.avatarUrl });
    }
    if (workspace.role === "owner") {
      map.set(user.id, {
        name: profile.display_name ?? t("ownerRole"),
        avatarUrl: profile.avatar_url,
      });
    }
    return map;
  }, [members.data, people, workspace.role, user.id, profile.display_name, profile.avatar_url, t]);
}

function Filters({
  filters,
  people,
  groups,
  names,
  onChange,
}: {
  filters: ActivityFilters;
  people: CompanyPerson[];
  groups: CompanyGroup[];
  names: Names;
  onChange: (next: Partial<ActivityFilters>) => void;
}) {
  const t = useTranslations("workers.company.activity");
  const personItems = [
    { value: ALL, label: t("filters.everyone") },
    ...[...names.entries()]
      .map(([id, entry]) => ({ value: id, label: entry.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const groupItems = [
    { value: ALL, label: t("filters.allGroups") },
    ...groups.map((group) => ({ value: group.id, label: group.name })),
  ];
  const kindItems = [
    { value: ALL, label: t("filters.allKinds") },
    ...ACTIVITY_KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) })),
  ];
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label={t("filters.period")}
        value={filters.period}
        options={ACTIVITY_PERIODS.map((period) => ({
          value: period,
          label: t(`periods.${period}`),
        }))}
        onChange={(period) => onChange({ period })}
      />
      <div className="flex flex-wrap gap-2">
        <FilterSelect
          label={t("filters.person")}
          testId="activity-person"
          value={filters.person ?? ALL}
          items={personItems}
          onChange={(value) => onChange({ person: value === ALL ? null : value, group: null })}
        />
        {groups.length > 0 && people.length > 0 && (
          <FilterSelect
            label={t("filters.group")}
            testId="activity-group"
            value={filters.group ?? ALL}
            items={groupItems}
            onChange={(value) => onChange({ group: value === ALL ? null : value, person: null })}
          />
        )}
        <FilterSelect
          label={t("filters.kind")}
          testId="activity-kind"
          value={filters.kind ?? ALL}
          items={kindItems}
          onChange={(value) => onChange({ kind: value === ALL ? null : (value as ActivityKind) })}
        />
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  testId,
  value,
  items,
  onChange,
}: {
  label: string;
  testId: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      items={items}
      onValueChange={(next) => typeof next === "string" && onChange(next)}
    >
      <SelectTrigger aria-label={label} data-testid={testId} className="w-auto min-w-40 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TimelineRow({ row, names }: { row: ActivityRow; names: Names }) {
  const t = useTranslations("workers.company.activity");
  const format = useFormatSettings();
  const summary = summaryOf(row.summary);
  const who = (row.actor_id && names.get(row.actor_id)) || null;
  const line = t(
    `lines.${sentenceKey(row)}` as never,
    {
      who: who?.name ?? t("someone"),
      title: summary.title ?? summary.customer ?? "none",
      stage: summary.stage ?? "none",
      table: summary.table ?? "none",
      kind: summary.kind ?? "other",
      type: summary.type ?? "other",
    } as never,
  );
  const href = activityHref(row);
  const amount =
    summary.amount !== null && summary.currency
      ? formatPrice(summary.amount, summary.currency, format)
      : null;
  const content = (
    <>
      <Avatar src={who?.avatarUrl} name={who?.name ?? "?"} className="size-8 text-xs" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm text-ink">{line}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          {formatDateTime(new Date(row.created_at), format)}
          {amount && <span className="tabular-nums">{amount}</span>}
          {row.via === "grady" && (
            <StatusPill tone="violet">
              <SparklesIcon aria-hidden className="size-3" />
              {t("via.grady")}
            </StatusPill>
          )}
          {row.via === "mcp" && (
            <StatusPill tone="teal">
              <PlugZapIcon aria-hidden className="size-3" />
              {t("via.mcp")}
            </StatusPill>
          )}
        </span>
      </div>
    </>
  );
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="flex min-h-14 items-center gap-3 px-3 py-2 outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-h-14 items-center gap-3 px-3 py-2">{content}</div>
      )}
    </li>
  );
}

function DailySummary({
  loading,
  failed,
  rows,
  names,
}: {
  loading: boolean;
  failed: boolean;
  rows: Parameters<typeof dailyByDay>[0];
  names: Names;
}) {
  const t = useTranslations("workers.company.activity");
  const format = useFormatSettings();
  const days = useMemo(() => dailyByDay(rows), [rows]);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="company-activity-daily">
      <h3 id="company-activity-daily" className="micro-label">
        {t("daily.title")}
      </h3>
      {failed ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : loading ? (
        <Skeleton className="h-24 w-full rounded-xl" aria-hidden />
      ) : days.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("daily.empty")}</p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="activity-daily">
          {days.slice(0, 14).map(({ day, people }) => (
            <div key={day} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-soft">
                {formatDate(isoDateToLocal(day), format)}
              </span>
              <ul className="flex flex-col gap-1">
                {people.map((row) => {
                  const who = names.get(row.actor_id);
                  return (
                    <li
                      key={`${day}-${row.actor_id}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-canvas-deep/40 px-3 py-2 text-sm"
                    >
                      <span className="min-w-32 font-medium text-ink">
                        {who?.name ?? t("someone")}
                      </span>
                      <span className="tabular-nums text-ink-soft">
                        {t("daily.tasks", { count: row.tasks })}
                      </span>
                      <span className="tabular-nums text-ink-soft">
                        {t("daily.deals", { count: row.deals })}
                      </span>
                      <span className="tabular-nums text-ink-soft">
                        {t("daily.calls", { count: row.calls })}
                      </span>
                      <span className="tabular-nums text-ink-soft">
                        {t("daily.meetings", { count: row.meetings })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
