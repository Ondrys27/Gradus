"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatTime, formatUtcOffset } from "@/lib/format";
import { listTimeZones } from "@/lib/region";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { groupZones, zoneLabel, zoneMatches, type Continent, type ZoneGroup } from "./time-zones";

/** Current time, refreshed on every full minute. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    const timeout = window.setTimeout(
      () => {
        setNow(new Date());
        interval = window.setInterval(() => setNow(new Date()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);
  return now;
}

type Props = {
  id: string;
  value: string;
  onChange: (zone: string) => void;
};

/**
 * Time zone picker: each zone shows its current time in the user's time format
 * and its offset from UTC, live to the minute. Searchable, grouped by continent.
 */
export function TimeZonePicker({ id, value, onChange }: Props) {
  const t = useTranslations("settings.region");
  const uiLocale = useLocale();
  const format = useFormatSettings();
  const now = useMinuteClock();

  const continentName = useCallback((continent: Continent) => t(`continents.${continent}`), [t]);
  const groups = useMemo<ZoneGroup[]>(() => {
    const zones = listTimeZones();
    if (!zones.includes(value)) zones.push(value);
    return groupZones(zones, continentName, uiLocale);
  }, [value, continentName, uiLocale]);

  const label = useCallback((zone: string) => zoneLabel(zone, continentName), [continentName]);
  const time = (zone: string) => formatTime(now, { ...format, timeZone: zone });

  return (
    <Combobox.Root
      items={groups}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string" && next !== value) onChange(next);
      }}
      itemToStringLabel={label}
      filter={(zone: string, query: string) => zoneMatches(zone, label(zone), query)}
      locale={uiLocale}
    >
      <Combobox.Trigger id={id} className="field cursor-pointer justify-between gap-2 text-left">
        <ZoneRow label={label(value)} time={time(value)} offset={formatUtcOffset(value, now)} />
        <ChevronDownIcon
          aria-hidden
          className="size-4 shrink-0 text-ink-muted transition-transform in-data-popup-open:rotate-180 motion-reduce:transition-none"
        />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={6} align="start" className="z-popover">
          <Combobox.Popup
            aria-label={t("timeZone")}
            className={cn(
              "flex max-h-[min(var(--available-height),420px)] w-(--anchor-width) max-w-(--available-width) min-w-72 origin-(--transform-origin) flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-popover outline-none",
              "transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none",
            )}
          >
            <div className="relative shrink-0 border-b border-line p-1.5">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-ink-muted"
              />
              <Combobox.Input
                placeholder={t("timeZoneSearch")}
                aria-label={t("timeZoneSearch")}
                className="field border-transparent bg-transparent pl-10 shadow-none"
              />
            </div>
            <Combobox.Empty className="px-4 py-3 text-sm text-ink-muted empty:hidden">
              {t("timeZoneEmpty")}
            </Combobox.Empty>
            <Combobox.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 empty:hidden">
              {(group: ZoneGroup) => (
                <Combobox.Group key={group.value} items={group.items} className="pb-1.5 last:pb-0">
                  <Combobox.GroupLabel className="micro-label sticky top-0 z-1 bg-surface px-3 py-2">
                    {continentName(group.value)}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(zone: string) => (
                      <Combobox.Item
                        key={zone}
                        value={zone}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink data-selected:text-ink mouse:min-h-9"
                      >
                        <ZoneRow
                          label={label(zone)}
                          time={time(zone)}
                          offset={formatUtcOffset(zone, now)}
                        />
                        <Combobox.ItemIndicator className="ml-auto text-violet">
                          <CheckIcon className="size-4" />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** "Evropa/Prague · 17:42 · UTC+2", the name truncating first. */
function ZoneRow({ label, time, offset }: { label: string; time: string; offset: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5" suppressHydrationWarning>
      <span className="truncate">{label}</span>
      <span aria-hidden className="shrink-0 text-ink-muted">
        ·
      </span>
      <span className="shrink-0 tabular-nums" suppressHydrationWarning>
        {time}
      </span>
      <span aria-hidden className="shrink-0 text-ink-muted">
        ·
      </span>
      <span className="shrink-0 text-xs text-ink-muted tabular-nums" suppressHydrationWarning>
        {offset}
      </span>
    </span>
  );
}
