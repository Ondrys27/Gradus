"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, HelpCircleIcon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveMembers } from "@/features/account/active-members";
import { useSession, useUserSettings } from "@/features/account/queries";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { track } from "@/lib/analytics/client";
import {
  formatCalendarDate,
  formatIsoTime,
  formatNumber,
  formatTime,
  todayIsoDate,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { addDaysIso, dayRangeToInstants } from "../../calendar-logic";
import {
  COMMON_TIME_DAYS,
  COMMON_TIME_DURATIONS,
  findCommonWindows,
  isWorkingDay,
  nextDays,
  splitBusy,
  startsInWindow,
  type FreeWindow,
} from "../common-time";
import { sharingErrorCode, useCalendarGroups, useCreateMeeting, usePeopleBusy } from "../queries";
import { RequestShareButton } from "./request-share-dialog";

const HOURS = Array.from({ length: 33 }, (_, index) => {
  const minutes = 6 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
const MINUTE = 60_000;
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/**
 * "Find a common time" (30.3): pick people (or a whole group) and a length;
 * the windows when everybody whose calendar the account sees is free in
 * working hours light up. Whoever shares nothing is marked "we don't know".
 * A window becomes a meeting with them, and each gets an invite into their
 * Gradus calendar.
 */
export function CommonTimeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("calendar.sharing.common");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,720px)]"
    >
      <CommonTime key={generation} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function CommonTime({ onDone }: { onDone: () => void }) {
  const t = useTranslations("calendar.sharing.common");
  const tSharing = useTranslations("calendar.sharing");
  const settings = useFormatSettings();
  const userSettings = useUserSettings();
  const { user } = useSession();
  const members = useActiveMembers();
  const groups = useCalendarGroups();
  const create = useCreateMeeting();
  const [people, setPeople] = useState<string[]>([]);
  const [duration, setDuration] = useState(30);
  const [workStart, setWorkStart] = useState("08:00");
  const [workEnd, setWorkEnd] = useState("17:30");
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<FreeWindow | null>(null);
  const [start, setStart] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [done, setDone] = useState(false);

  const today = todayIsoDate(settings);
  const days = useMemo(
    () => nextDays(addDaysIso(today, offset), COMMON_TIME_DAYS),
    [today, offset],
  );
  const range = dayRangeToInstants(days[0], days[days.length - 1], settings.timeZone);
  const busyQuery = usePeopleBusy(people, range.from, range.to, people.length > 0);
  const others = (members.data ?? []).filter((member) => member.userId !== user.id);
  const nameOf = new Map(others.map((member) => [member.userId, member.name]));

  const { busy, unknown } = useMemo(() => splitBusy(busyQuery.data ?? []), [busyQuery.data]);
  const windows = useMemo(
    () =>
      people.length
        ? findCommonWindows({
            days,
            timeZone: settings.timeZone,
            workStart,
            workEnd,
            durationMin: duration,
            busy,
            nowMs: Date.now(),
            country: userSettings.country_code || null,
          })
        : [],
    [
      people.length,
      days,
      settings.timeZone,
      workStart,
      workEnd,
      duration,
      busy,
      userSettings.country_code,
    ],
  );

  // One event per search that found something, never names.
  const searchKey = `${people.length}:${duration}:${windows.length}:${unknown.length}`;
  useEffect(() => {
    if (!people.length || busyQuery.isPending || busyQuery.isFetching) return;
    track("calendar_common_time_searched", {
      people: people.length,
      unknown: unknown.length,
      duration_min: duration,
      windows: windows.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, busyQuery.isFetching]);

  function toggle(id: string, on: boolean) {
    setPicked(null);
    setPeople((current) =>
      on ? [...new Set([...current, id])] : current.filter((person) => person !== id),
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="success">{t("created")}</FormAlert>
        <Button type="button" className="self-end" onClick={onDone}>
          {t("close")}
        </Button>
      </div>
    );
  }

  const workMinutes = Math.max(30, toMinutes(workEnd) - toMinutes(workStart));
  const starts = picked ? startsInWindow(picked, duration) : [];
  const chosenStart = start ?? starts[0] ?? null;

  return (
    <div
      className="flex flex-col gap-5"
      data-testid="common-time"
      data-tutorial="calendar-common-time-panel"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink-soft">{t("people")}</legend>
        {(groups.data ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(groups.data ?? []).map((group) => (
              <Button
                key={group.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setPicked(null);
                  setPeople((current) => [
                    ...new Set([...current, ...group.people.filter((id) => id !== user.id)]),
                  ]);
                }}
              >
                <UsersIcon aria-hidden data-icon="inline-start" />
                {group.name}
              </Button>
            ))}
          </div>
        )}
        <div className="grid gap-x-4 sm:grid-cols-2">
          {others.map((member) => (
            <label
              key={member.userId}
              className="flex min-h-11 items-center gap-2 text-sm text-ink-soft mouse:min-h-9"
              data-testid="common-time-person"
            >
              <Checkbox
                checked={people.includes(member.userId)}
                onCheckedChange={(checked) => toggle(member.userId, Boolean(checked))}
              />
              <Avatar
                src={member.avatarUrl}
                name={member.name}
                presenceOf={member.userId}
                className="size-6"
              />
              <span className="truncate">{member.name}</span>
              {unknown.includes(member.userId) && (
                <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2 text-[11px] text-ink-muted">
                  <HelpCircleIcon aria-hidden className="size-3" />
                  {t("unknown")}
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="common-time-duration" label={t("duration")}>
          <Select
            value={String(duration)}
            items={COMMON_TIME_DURATIONS.map((value) => ({
              value: String(value),
              label: t("minutes", { count: formatNumber(value, {}, settings) }),
            }))}
            onValueChange={(next) => {
              setPicked(null);
              setDuration(Number(next) || 30);
            }}
          >
            <SelectTrigger id="common-time-duration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMON_TIME_DURATIONS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {t("minutes", { count: formatNumber(value, {}, settings) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <HourSelect
          id="common-time-from"
          label={t("from")}
          value={workStart}
          onChange={setWorkStart}
        />
        <HourSelect id="common-time-to" label={t("to")} value={workEnd} onChange={setWorkEnd} />
      </div>

      {unknown.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-line-strong p-3 text-sm text-ink-soft">
          <p>
            {t("unknownHint", {
              names: unknown
                .map((id) => nameOf.get(id) ?? "")
                .filter(Boolean)
                .join(", "),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            {unknown.map((id) => (
              <RequestShareButton key={id} personId={id} from="calendar" variant="ghost" />
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("previous")}
          disabled={offset <= 0}
          onClick={() => {
            setPicked(null);
            setOffset((value) => Math.max(0, value - COMMON_TIME_DAYS));
          }}
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <p className="text-sm font-medium text-ink">
          {formatCalendarDate(days[0], settings)} –{" "}
          {formatCalendarDate(days[days.length - 1], settings)}
        </p>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("next")}
          onClick={() => {
            setPicked(null);
            setOffset((value) => value + COMMON_TIME_DAYS);
          }}
        >
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>

      {!people.length ? (
        <p className="text-sm text-ink-muted">{t("pickPeople")}</p>
      ) : busyQuery.isError ? (
        <FormAlert>{tSharing("errors.unknown")}</FormAlert>
      ) : (
        <ul className="flex flex-col gap-2" aria-busy={busyQuery.isFetching}>
          {days.map((day) => {
            const working = isWorkingDay(day, settings.timeZone, userSettings.country_code || null);
            const inDay = windows.filter((window) => window.day === day);
            return (
              <li key={day} className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                <span className={cn("text-xs", working ? "text-ink-soft" : "text-ink-muted")}>
                  {formatCalendarDate(day, settings)}
                </span>
                <div
                  className={cn(
                    "relative h-11 rounded-lg border border-line bg-[repeating-linear-gradient(135deg,var(--color-surface-hover)_0_6px,transparent_6px_12px)] mouse:h-9",
                    !working && "opacity-40",
                  )}
                >
                  {inDay.map((window) => {
                    const dayStart = Date.parse(
                      dayRangeToInstants(day, day, settings.timeZone).from,
                    );
                    const left =
                      ((window.startMs - dayStart) / MINUTE - toMinutes(workStart)) / workMinutes;
                    const width = (window.endMs - window.startMs) / MINUTE / workMinutes;
                    const selected = picked?.startMs === window.startMs;
                    return (
                      <button
                        key={window.startMs}
                        type="button"
                        onClick={() => {
                          setPicked(window);
                          setStart(null);
                        }}
                        aria-pressed={selected}
                        className={cn(
                          "absolute inset-y-0.5 min-w-6 cursor-pointer overflow-hidden rounded-md border px-1 text-left text-[11px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                          selected
                            ? "border-teal bg-teal text-canvas"
                            : "border-teal/60 bg-teal/25 text-ink",
                        )}
                        style={{
                          left: `${Math.max(0, left) * 100}%`,
                          width: `${Math.min(1, width) * 100}%`,
                        }}
                        data-testid="common-time-window"
                      >
                        <span className="truncate">
                          {formatTime(new Date(window.startMs), settings)}–
                          {formatTime(new Date(window.endMs), settings)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
          {!busyQuery.isFetching && windows.length === 0 && (
            <p className="text-sm text-ink-muted">{t("noWindows")}</p>
          )}
        </ul>
      )}

      {picked && chosenStart !== null && (
        <form
          className="flex flex-col gap-4 rounded-2xl border border-teal/40 bg-teal/5 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              {
                title: title.trim() || t("defaultTitle"),
                startsAt: new Date(chosenStart).toISOString(),
                endsAt: new Date(chosenStart + duration * MINUTE).toISOString(),
                attendees: people,
                description: "",
              },
              { onSuccess: () => setDone(true) },
            );
          }}
          data-testid="common-time-create"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="common-time-title" label={t("meetingTitle")}>
              <Input
                id="common-time-title"
                value={title}
                maxLength={120}
                placeholder={t("defaultTitle")}
                onChange={(event) => setTitle(event.target.value)}
              />
            </FormField>
            <FormField id="common-time-start" label={t("start")}>
              <Select
                value={String(chosenStart)}
                items={starts.map((ms) => ({
                  value: String(ms),
                  label: formatTime(new Date(ms), settings),
                }))}
                onValueChange={(next) => setStart(Number(next))}
              >
                <SelectTrigger id="common-time-start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {starts.map((ms) => (
                    <SelectItem key={ms} value={String(ms)}>
                      {formatTime(new Date(ms), settings)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <p className="text-xs text-ink-muted">
            {t("invites", {
              names: people
                .map((id) => nameOf.get(id) ?? "")
                .filter(Boolean)
                .join(", "),
            })}
          </p>
          {create.isError && (
            <FormAlert>
              {tSharing(
                `errors.${sharingErrorCode(create.error) === "calendar_meeting_denied" ? "calendar_meeting_denied" : "unknown"}`,
              )}
            </FormAlert>
          )}
          <Button
            type="submit"
            className="self-end"
            disabled={create.isPending}
            data-testid="common-time-submit"
          >
            {t("create")}
          </Button>
        </form>
      )}
    </div>
  );
}

function HourSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const settings = useFormatSettings();
  const items = HOURS.map((hour) => ({ value: hour, label: formatIsoTime(hour, settings) }));
  return (
    <FormField id={id} label={label}>
      <Select value={value} items={items} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger id={id}>
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
    </FormField>
  );
}
