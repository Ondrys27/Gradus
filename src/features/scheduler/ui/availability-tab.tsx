"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarOffIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeZonePicker } from "@/features/settings/time-zone-picker";
import { formatCalendarDate, formatIsoTime, todayIsoDate, type IsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  useAddOverrides,
  useAvailability,
  useDeleteOverrides,
  useSaveWeeklyRules,
  useUpdateProfile,
  writeProblem,
} from "../queries";
import type { SchedulerProfile } from "../types";
import {
  endMinutes,
  rulesToWeek,
  sameWeek,
  weekIssues,
  weekToRules,
  type Week,
} from "../weekly-hours";
import { addDays, daysBetween, minutesOfTime } from "../zoned";
import { WeeklyHoursEditor } from "./weekly-hours-editor";

/** An exception covers at most this many days at once (a long holiday). */
const MAX_RANGE_DAYS = 60;

/**
 * The person's availability: their time zone, the working hours of the week
 * (the default of every meeting type) and exceptions by date — a day off, a
 * holiday, other hours on one day.
 */
export function AvailabilityTab({
  profile,
  editable,
}: {
  profile: SchedulerProfile;
  editable: boolean;
}) {
  const t = useTranslations("scheduler.availability");
  const availability = useAvailability(profile.id);
  const updateProfile = useUpdateProfile(profile.id);

  return (
    <div className="flex max-w-[720px] flex-col gap-8">
      <section className="flex flex-col gap-3">
        <header className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold text-ink">{t("zoneTitle")}</h2>
          <p className="text-[13px] text-ink-muted">{t("zoneHint")}</p>
        </header>
        <div className="max-w-sm">
          <TimeZonePicker
            id="scheduler-time-zone"
            value={profile.time_zone}
            onChange={(zone) => editable && updateProfile.mutate({ time_zone: zone })}
          />
        </div>
        {updateProfile.isError && <FormAlert>{t("saveFailed")}</FormAlert>}
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-6">
        <header className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold text-ink">{t("weekTitle")}</h2>
          <p className="text-[13px] text-ink-muted">{t("weekHint")}</p>
        </header>
        {availability.isPending ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : availability.isError ? (
          <FormAlert>{t("loadFailed")}</FormAlert>
        ) : (
          <WeekForm
            profileId={profile.id}
            eventTypeId={null}
            rules={availability.data.rules.filter((rule) => rule.event_type_id === null)}
            editable={editable}
          />
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-6">
        <header className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold text-ink">{t("exceptionsTitle")}</h2>
          <p className="text-[13px] text-ink-muted">{t("exceptionsHint")}</p>
        </header>
        {availability.data && (
          <Exceptions
            profileId={profile.id}
            overrides={availability.data.overrides}
            editable={editable}
          />
        )}
      </section>
    </div>
  );
}

/** The weekly hours with their own Save; used for the profile and for one meeting type. */
export function WeekForm({
  profileId,
  eventTypeId,
  rules,
  editable,
  onSaved,
}: {
  profileId: string;
  eventTypeId: string | null;
  rules: Array<{ id: string; weekday: number; start_time: string; end_time: string }>;
  editable: boolean;
  onSaved?: () => void;
}) {
  const t = useTranslations("scheduler.availability");
  const save = useSaveWeeklyRules(profileId);
  const stored = useMemo(() => rulesToWeek(rules), [rules]);
  const [week, setWeek] = useState<Week>(stored);
  // A save (or another tab) changes what is stored: show it.
  useEffect(() => setWeek(stored), [stored]);
  const dirty = !sameWeek(week, stored);
  const invalid = weekIssues(week).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <WeeklyHoursEditor
        idPrefix={`hours-${eventTypeId ?? "profile"}`}
        week={week}
        onChange={setWeek}
        disabled={!editable}
      />
      {save.isError && (
        <FormAlert>
          {writeProblem(save.error) === "readOnly" ? t("readOnly") : t("saveFailed")}
        </FormAlert>
      )}
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={!dirty || invalid || save.isPending}
            onClick={() =>
              save.mutate(
                { eventTypeId, rules: weekToRules(week), previous: rules.map((rule) => rule.id) },
                { onSuccess: onSaved },
              )
            }
          >
            {save.isPending ? t("saving") : t("saveWeek")}
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setWeek(stored)}>
              {t("discard")}
            </Button>
          )}
          {save.isSuccess && !dirty && <span className="text-sm text-green">{t("saved")}</span>}
        </div>
      )}
    </div>
  );
}

type OverrideRow = { id: string; date: string; start_time: string | null; end_time: string | null };

function Exceptions({
  profileId,
  overrides,
  editable,
}: {
  profileId: string;
  overrides: OverrideRow[];
  editable: boolean;
}) {
  const t = useTranslations("scheduler.availability");
  const settings = useFormatSettings();
  const today = todayIsoDate(settings);
  const add = useAddOverrides(profileId);
  const remove = useDeleteOverrides(profileId);
  const [from, setFrom] = useState<IsoDate | null>(null);
  const [to, setTo] = useState<IsoDate | null>(null);
  const [mode, setMode] = useState<"blocked" | "hours">("blocked");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");

  const last = to && from && to >= from ? to : from;
  const span = from && last ? daysBetween(from, last) + 1 : 0;
  const tooLong = span > MAX_RANGE_DAYS;
  const badHours = mode === "hours" && !(minutesOfTime(start) < endMinutes(end));
  const canAdd = Boolean(from) && from! >= today && !tooLong && !badHours && !add.isPending;

  // One row per day; several rows of a day are its intervals.
  const byDate = useMemo(() => {
    const map = new Map<string, OverrideRow[]>();
    for (const row of overrides.filter((item) => item.date >= today)) {
      const list = map.get(row.date) ?? [];
      list.push(row);
      map.set(row.date, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [overrides, today]);

  return (
    <div className="flex flex-col gap-5">
      {editable && (
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="override-from" label={t("from")}>
              <DatePicker
                id="override-from"
                value={from}
                onValueChange={setFrom}
                placeholder={t("pickDate")}
              />
            </FormField>
            <FormField id="override-to" label={t("to")} hint={t("toHint")}>
              <DatePicker
                id="override-to"
                value={to}
                onValueChange={setTo}
                placeholder={t("sameDay")}
              />
            </FormField>
          </div>
          <div role="radiogroup" aria-label={t("kind")} className="flex flex-wrap gap-2">
            {(["blocked", "hours"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                onClick={() => setMode(option)}
                className={cn(
                  "min-h-11 cursor-pointer rounded-xl border px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9",
                  mode === option
                    ? "border-violet bg-violet/12 text-ink"
                    : "border-line text-ink-soft hover:text-ink",
                )}
              >
                {t(`kinds.${option}`)}
              </button>
            ))}
          </div>
          {mode === "hours" && (
            <div className="flex items-center gap-2">
              <Input
                type="time"
                step={900}
                value={start}
                aria-label={t("hoursFrom")}
                onChange={(event) => setStart(event.target.value)}
                className="w-32"
              />
              <span aria-hidden className="text-ink-muted">
                –
              </span>
              <Input
                type="time"
                step={900}
                value={end}
                aria-label={t("hoursTo")}
                onChange={(event) => setEnd(event.target.value)}
                className="w-32"
              />
            </div>
          )}
          {tooLong && <p className="text-xs text-pink">{t("tooLong", { days: MAX_RANGE_DAYS })}</p>}
          {badHours && <p className="text-xs text-pink">{t("badHours")}</p>}
          {add.isError && <FormAlert>{t("saveFailed")}</FormAlert>}
          <Button
            type="button"
            className="self-start"
            disabled={!canAdd}
            onClick={() => {
              if (!from || !last) return;
              const dates = Array.from({ length: span }, (_, index) => addDays(from, index));
              add.mutate(
                {
                  dates,
                  intervals:
                    mode === "hours"
                      ? [{ start_time: start, end_time: endMinutes(end) === 1440 ? "24:00" : end }]
                      : null,
                },
                {
                  onSuccess: () => {
                    setFrom(null);
                    setTo(null);
                  },
                },
              );
            }}
          >
            {t("addException")}
          </Button>
        </div>
      )}

      {byDate.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <CalendarOffIcon aria-hidden className="size-4" />
          {t("noExceptions")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/60">
          {byDate.map(([date, rows]) => {
            const blocked = rows.some((row) => row.start_time === null);
            return (
              <li key={date} className="flex min-h-12 items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-ink">
                    {formatCalendarDate(date, settings)}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {blocked
                      ? t("blockedDay")
                      : rows
                          .map(
                            (row) =>
                              `${formatIsoTime(row.start_time!.slice(0, 5), settings)}–${formatIsoTime(row.end_time!.slice(0, 5), settings)}`,
                          )
                          .join(", ")}
                  </span>
                </div>
                {editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("removeException", { date: formatCalendarDate(date, settings) })}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate([date])}
                  >
                    <Trash2Icon aria-hidden className="text-destructive" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
