"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Actions,
  defineWidget,
  DetailHeading,
  Hero,
  Row,
  RowList,
  Stack,
  Sub,
  type WidgetDetailProps,
  type WidgetViewProps,
} from "@/features/widgets/kit";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ERROR_GROUP_STATUSES, type ErrorGroupStatus } from "../../error-log";
import { ADMIN_FORMAT_SETTINGS } from "../../format-metric";
import { setErrorGroupStatus } from "../../server/error-log-actions";
import { ERROR_BADGE_EVENT } from "../error-badge-client";
import type { AdminWidgetData, WidgetErrorGroup, WidgetFigure, WidgetRow } from "../data";
import { adminWidgetKeys, useAdminWidgetData } from "../use-widget-data";
import { ChartColumns, StandardDetail, useFigureText, useRootT } from "../views";

/**
 * Errors (29.3): the one widget that must say at a glance whether all is
 * quiet or something burns. The hero is the count of open errors: pink while
 * any came in today (they wait for a hand), gold while older ones stay open,
 * and a calm green zero when there is nothing. Under it the days of the
 * period as columns and the most frequent groups with their code. A group
 * that was not there a minute ago lights up briefly, never with an alarm.
 * The detail lists the new errors with a quick change of state; a click on
 * one opens it in the log (27.2).
 */

/** How long a just-arrived error group keeps its glow (ms). */
const FRESH_MS = 4_000;

function figureOf(data: AdminWidgetData, key: string): WidgetFigure | undefined {
  return data.figures.find((figure) => figure.key === key);
}

/**
 * Fingerprints that arrived after the first load, for a few seconds: a
 * refetch that brings a new group marks it (the first load marks nothing).
 */
function useFreshGroups(ids: readonly string[]): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const key = ids.join("|");
  useEffect(() => {
    const current = new Set(key ? key.split("|") : []);
    if (seen.current === null) {
      seen.current = current;
      return;
    }
    const arrived = [...current].filter((id) => !seen.current!.has(id));
    seen.current = current;
    if (arrived.length === 0) return;
    setFresh(new Set(arrived));
    const timer = window.setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => window.clearTimeout(timer);
  }, [key]);
  return fresh;
}

function stateOf(data: AdminWidgetData): "calm" | "waiting" | "burning" {
  const newToday = figureOf(data, "newToday")?.value ?? 0;
  const open = figureOf(data, "open")?.value ?? 0;
  if (newToday > 0) return "burning";
  if (open > 0) return "waiting";
  return "calm";
}

/** The hero of the widget: open errors in the colour of the state, the line under it. */
function ErrorsHero({
  data,
  size,
  fresh,
}: {
  data: AdminWidgetData;
  size: "lg" | "md";
  fresh: boolean;
}) {
  const t = useTranslations("admin.widgets.errors");
  const text = useFigureText();
  const state = stateOf(data);
  const open = figureOf(data, "open");
  const newToday = figureOf(data, "newToday");
  const users = figureOf(data, "users");
  const returned = figureOf(data, "returned");
  const status = state === "burning" ? "bad" : state === "waiting" ? "warn" : "good";
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-errors-state={state}>
      <div className={cn("flex min-w-0 items-baseline gap-2 rounded-lg", fresh && "motion-safe:animate-error-flash")}>
        <Hero size={size} status={status} className={size === "md" ? "@max-md:text-2xl @max-md:leading-none" : undefined}>
          {text(open?.value ?? 0, "count")}
        </Hero>
        <span className={cn("text-sm font-medium", status === "bad" ? "text-pink" : status === "warn" ? "text-gold" : "text-green")}>
          {state === "calm" ? t("calm") : t("figures.open")}
        </span>
      </div>
      <Sub className="text-xs @md:text-sm">
        {state === "calm" ? (
          t("calmHint")
        ) : (
          <span className="flex min-w-0 flex-wrap gap-x-3">
            <Count figure={newToday} tone="pink" />
            <Count figure={users} />
            {returned && (returned.value ?? 0) > 0 && <Count figure={returned} tone="gold" />}
          </span>
        )}
      </Sub>
    </div>
  );
}

function Count({ figure, tone }: { figure: WidgetFigure | undefined; tone?: "pink" | "gold" }) {
  const t = useRootT();
  const text = useFigureText();
  if (!figure) return null;
  const value = figure.value ?? 0;
  return (
    <span className="flex items-baseline gap-1">
      <span className={cn("font-semibold tabular-nums", value > 0 && tone === "pink" && "text-pink", value > 0 && tone === "gold" && "text-gold", (value === 0 || !tone) && "text-ink")}>
        {text(value, figure.unit)}
      </span>
      <span>{t(figure.label, figure.labelValues)}</span>
    </span>
  );
}

/** The most frequent groups: code in mono, the message, the count; a dot says new or came back. */
function TopGroups({
  rows,
  fresh,
  limit,
  compact = false,
}: {
  rows: WidgetRow[];
  fresh: ReadonlySet<string>;
  limit: number;
  compact?: boolean;
}) {
  const t = useTranslations("admin.widgets.errors");
  const shown = rows.slice(0, limit);
  if (shown.length === 0) return null;
  return (
    <RowList className="-mx-1">
      {shown.map((row) => (
        <Row
          key={row.id}
          href={row.href}
          mark={row.status === "bad" ? "pink" : "gold"}
          className={cn("px-1", fresh.has(row.id) && "motion-safe:animate-error-flash rounded-lg")}
          trail={
            <span className="font-semibold text-ink">
              {formatNumber(row.value ?? 0, {}, ADMIN_FORMAT_SETTINGS)}
              <span className="font-normal text-ink-muted"> ×</span>
            </span>
          }
        >
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-baseline gap-2">
              <code className="shrink-0 font-mono text-xs text-ink-soft">{row.text}</code>
              {row.status === "warn" && (
                <span className="truncate text-[11px] text-gold">{t("cameBack")}</span>
              )}
              {fresh.has(row.id) && <span className="sr-only">{t("fresh")}</span>}
            </span>
            {!compact && <span className="truncate text-xs text-ink-muted">{row.sub}</span>}
          </span>
        </Row>
      ))}
    </RowList>
  );
}

function ErrorsView(props: WidgetViewProps<AdminWidgetData>) {
  const { size, data } = props;
  const t = useTranslations("admin.widgets.errors");
  const tBoard = useTranslations("dashboard.board");
  const reduceMotion = useReducedMotionSafe();
  const rows = data.rows ?? [];
  const fresh = useFreshGroups(rows.map((row) => row.id));
  const freshHero = !reduceMotion && fresh.size > 0;
  const state = stateOf(data);
  const columns = data.chart ? (
    <ChartColumns chart={data.chart} tone={state === "calm" ? "green" : "pink"} days={size === "XL" ? undefined : 14} height={size === "M" ? 24 : size === "L" ? 44 : 80} labels={size !== "M"} />
  ) : null;
  const actions = [
    { label: t("openLog"), href: "/admin/chyby?status=new" },
    { label: t("alerts"), href: "/admin/chyby?tab=alerts" },
  ];
  const testId = state === "calm" ? "errors-widget-calm" : "errors-widget";

  if (size === "M") {
    return (
      <Stack between>
        <div data-testid={testId}>
          <ErrorsHero data={data} size="md" fresh={freshHero} />
        </div>
        {columns}
      </Stack>
    );
  }

  if (size === "L") {
    return (
      <Stack className="gap-2.5">
        <div data-testid={testId}>
          <ErrorsHero data={data} size="md" fresh={freshHero} />
        </div>
        {columns}
        {rows.length > 0 ? (
          <TopGroups rows={rows} fresh={fresh} limit={3} compact />
        ) : (
          state !== "calm" && <Sub className="text-xs text-ink-muted">{t("noneNew")}</Sub>
        )}
        <Actions items={[actions[0]]} />
      </Stack>
    );
  }

  // XL: the hero and the days of the period on the left, the most frequent groups on the right.
  return (
    <Stack className="gap-3">
      <div className="grid min-h-0 flex-1 gap-x-6 gap-y-3 @2xl:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-3">
          <div data-testid={testId}>
            <ErrorsHero data={data} size="md" fresh={freshHero} />
          </div>
          {columns}
        </div>
        <div className="flex min-h-0 flex-col gap-1.5">
          <DetailHeading>{t("top")}</DetailHeading>
          {rows.length > 0 ? (
            <TopGroups rows={rows} fresh={fresh} limit={5} />
          ) : (
            <Sub className="text-xs text-ink-muted">{state === "calm" ? t("calmHint") : t("noneNew")}</Sub>
          )}
        </div>
      </div>
      <Actions items={[...actions, { label: tBoard("openSection"), href: "/admin/chyby" }]} />
    </Stack>
  );
}

function ErrorsDetail(props: WidgetDetailProps<AdminWidgetData>) {
  const t = useTranslations("admin.widgets.errors");
  const groups = props.data.errors ?? [];
  return (
    <StandardDetail {...props}>
      <section className="flex flex-col gap-2">
        <DetailHeading>{t("newList")}</DetailHeading>
        {groups.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("noneNew")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="errors-widget-new">
            {groups.map((group) => (
              <ErrorGroupItem key={group.fingerprint} group={group} onOpen={props.close} />
            ))}
          </ul>
        )}
      </section>
    </StandardDetail>
  );
}

function ErrorGroupItem({ group, onOpen }: { group: WidgetErrorGroup; onOpen: () => void }) {
  const t = useTranslations("admin.widgets.errors");
  const tStatus = useTranslations("admin.errors.status");
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ErrorGroupStatus>(group.status);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function change(next: ErrorGroupStatus) {
    if (next === status) return;
    const before = status;
    setStatus(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setErrorGroupStatus(group.fingerprint, next);
      if (!result.ok) {
        setStatus(before);
        setFailed(true);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: adminWidgetKeys.all });
      window.dispatchEvent(new Event(ERROR_BADGE_EVENT));
    });
  }

  return (
    <li className="flex flex-col gap-2 py-3" data-testid="errors-widget-group" data-code={group.code}>
      <Link
        href={`/admin/chyby?group=${group.fingerprint}`}
        onClick={onOpen}
        className="flex min-w-0 flex-col gap-0.5 rounded-lg outline-none hover:text-violet focus-visible:ring-3 focus-visible:ring-violet/40"
        data-testid="errors-widget-link"
      >
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          <code className="font-mono text-xs text-ink-soft">{group.code}</code>
          {group.returned && (
            <span className="rounded-full bg-gold/15 px-2 text-[11px] font-medium text-gold">
              {t("cameBack")}
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-sm text-ink">{group.message}</span>
        <span className="text-xs text-ink-muted">
          {t("groupMeta", {
            page: group.page,
            occurrences: group.occurrences,
            users: group.users,
            at: formatDateTime(new Date(group.lastAt), ADMIN_FORMAT_SETTINGS),
          })}
        </span>
      </Link>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("changeStatus")}>
        {ERROR_GROUP_STATUSES.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={value === status ? "default" : "outline"}
            disabled={pending}
            aria-pressed={value === status}
            onClick={() => change(value)}
            className={cn("min-h-9")}
          >
            {tStatus(value)}
          </Button>
        ))}
      </div>
      {failed && <p className="text-xs text-pink">{t("statusFailed")}</p>}
    </li>
  );
}

export const errorsWidget = defineWidget<AdminWidgetData>({
  key: "errors",
  useData: (settings) => useAdminWidgetData("errors", settings),
  View: ErrorsView,
  Detail: ErrorsDetail,
});
