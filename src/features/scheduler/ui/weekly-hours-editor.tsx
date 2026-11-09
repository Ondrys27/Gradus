"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { weekdayName } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  MAX_INTERVALS_PER_DAY,
  nextInterval,
  orderedWeekdays,
  weekIssues,
  type HoursInterval,
  type Week,
} from "../weekly-hours";

/**
 * Working hours day by day, several intervals a day: a switch per day
 * (closed = no intervals), the intervals as time fields, add and remove.
 * Controlled: the parent keeps the week and saves it.
 */
export function WeeklyHoursEditor({
  idPrefix,
  week,
  onChange,
  disabled,
}: {
  idPrefix: string;
  week: Week;
  onChange: (week: Week) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("scheduler.hours");
  const locale = useLocale();
  const settings = useFormatSettings();
  const issues = weekIssues(week);

  const setDay = (weekday: number, list: HoursInterval[]) => onChange({ ...week, [weekday]: list });

  return (
    <div className="flex flex-col divide-y divide-line/60">
      {orderedWeekdays(settings.weekStartsOn).map((weekday) => {
        const list = week[weekday] ?? [];
        const open = list.length > 0;
        const dayName = weekdayName(weekday, locale);
        return (
          <div
            key={weekday}
            className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 md:flex-row md:items-start md:gap-4"
          >
            <div className="flex min-h-11 items-center gap-3 md:w-44 md:shrink-0">
              <Switch
                checked={open}
                disabled={disabled}
                aria-label={t("dayOpen", { day: dayName })}
                onCheckedChange={(checked) => setDay(weekday, checked ? [nextInterval([])] : [])}
              />
              <span
                className={cn(
                  "text-sm font-medium capitalize",
                  open ? "text-ink" : "text-ink-muted",
                )}
              >
                {dayName}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {!open && (
                <p className="flex min-h-11 items-center text-sm text-ink-muted">{t("closed")}</p>
              )}
              {list.map((interval, index) => {
                const issue = issues.find(
                  (item) => item.weekday === weekday && item.index === index,
                );
                const id = `${idPrefix}-${weekday}-${index}`;
                return (
                  <div key={index} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Input
                        id={`${id}-start`}
                        type="time"
                        step={900}
                        value={interval.start}
                        disabled={disabled}
                        aria-label={t("from", { day: dayName })}
                        aria-invalid={issue ? true : undefined}
                        onChange={(event) =>
                          setDay(
                            weekday,
                            list.map((item, i) =>
                              i === index ? { ...item, start: event.target.value } : item,
                            ),
                          )
                        }
                        className="w-32"
                      />
                      <span aria-hidden className="text-ink-muted">
                        –
                      </span>
                      <Input
                        id={`${id}-end`}
                        type="time"
                        step={900}
                        value={interval.end}
                        disabled={disabled}
                        aria-label={t("to", { day: dayName })}
                        aria-invalid={issue ? true : undefined}
                        onChange={(event) =>
                          setDay(
                            weekday,
                            list.map((item, i) =>
                              i === index ? { ...item, end: event.target.value } : item,
                            ),
                          )
                        }
                        className="w-32"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        aria-label={t("remove", { day: dayName })}
                        onClick={() =>
                          setDay(
                            weekday,
                            list.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <XIcon aria-hidden />
                      </Button>
                    </div>
                    {issue && <p className="text-xs text-pink">{t(`issues.${issue.code}`)}</p>}
                  </div>
                );
              })}
              {open && list.length < MAX_INTERVALS_PER_DAY && !disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => setDay(weekday, [...list, nextInterval(list)])}
                >
                  <PlusIcon aria-hidden data-icon="inline-start" />
                  {t("add")}
                </Button>
              )}
            </div>
          </div>
        );
      })}
      <p className="pt-3 text-xs text-ink-muted">{t("midnightHint")}</p>
    </div>
  );
}
