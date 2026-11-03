"use client";

import { useEffect, useMemo, useState } from "react";
import { LocateFixedIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useUserSettings } from "@/features/account/queries";
import {
  countryName,
  CURRENCIES,
  currencyName,
  DATE_FORMATS,
  formatDate,
  formatNumber,
  formatTime,
  NUMBER_FORMATS,
  TIME_FORMATS,
  WEEK_STARTS,
  weekdayName,
  type NumberFormatKey,
} from "@/lib/format";
import { browserTimeZone, COUNTRY_CODES, countryFromTimeZone } from "@/lib/region";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { UserSettingsPatch } from "@/lib/user-settings";
import { ThemeGrid } from "./appearance-settings";
import { FormatPreview, useNow } from "./format-preview";
import { useSettingsSave } from "./save-state";
import { TimeZonePicker } from "./time-zone-picker";
import { SettingRow, SettingsPage, SettingsSection } from "./ui";

type Option = { value: string; label: string; detail?: string };

/**
 * Settings → Appearance and formats: the theme, sound and animations, then
 * the country, time zone, currency and the shape of dates, times and numbers,
 * with a live sample of them underneath.
 */
export function AppearanceView() {
  const t = useTranslations("settings");
  const uiLocale = useLocale();
  const settings = useUserSettings();
  const format = useFormatSettings();
  const { save } = useSettingsSave();
  const now = useNow();

  // Read after mount: the server does not know the browser's zone.
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  useEffect(() => setBrowserZone(browserTimeZone()), []);
  const browserCountry = browserZone ? countryFromTimeZone(browserZone) : null;

  const countryOptions = useMemo<Option[]>(
    () =>
      COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code, uiLocale) })).sort(
        (a, b) => a.label.localeCompare(b.label, uiLocale),
      ),
    [uiLocale],
  );
  const currencyOptions = useMemo<Option[]>(() => {
    const codes: string[] = [...CURRENCIES];
    if (!codes.includes(settings.currency)) codes.push(settings.currency);
    return codes.map((code) => ({ value: code, label: code, detail: currencyName(code, uiLocale) }));
  }, [settings.currency, uiLocale]);
  const dateOptions: Option[] = DATE_FORMATS.map((pattern) => ({
    value: pattern,
    label: formatDate(now, { ...format, dateFormat: pattern }),
    detail: pattern,
  }));
  const timeOptions: Option[] = TIME_FORMATS.map((pattern) => ({
    value: pattern,
    label: formatTime(now, { ...format, timeFormat: pattern }),
    detail: t(`timeFormats.${pattern === "HH:mm" ? "h24" : "h12"}`),
  }));
  const numberOptions: Option[] = (Object.keys(NUMBER_FORMATS) as NumberFormatKey[]).map((key) => ({
    value: key,
    label: formatNumber(1234567.89, { decimals: 2 }, { ...format, numberLocale: NUMBER_FORMATS[key] }),
  }));
  const weekOptions: Option[] = WEEK_STARTS.map((day) => ({
    value: String(day),
    label: weekdayName(day, uiLocale),
  }));

  return (
    <SettingsPage
      title={t("groups.appearance.title")}
      description={t("groups.appearance.description")}
    >
      <SettingsSection title={t("appearance.title")} description={t("appearance.description")}>
        <SettingRow id="settings-theme" label={t("appearance.theme")} fields={["theme"]} group layout="stack">
          <ThemeGrid />
        </SettingRow>
        <SettingRow
          id="settings-sound"
          label={t("gameplay.sound")}
          hint={t("gameplay.soundHint")}
          fields={["sound_enabled"]}
        >
          <div className="flex md:justify-end">
            <Switch
              id="settings-sound"
              checked={settings.sound_enabled}
              onCheckedChange={(checked) => save({ sound_enabled: checked })}
            />
          </div>
        </SettingRow>
        <SettingRow
          id="settings-animations"
          label={t("gameplay.animations")}
          hint={t("gameplay.animationsHint")}
          fields={["animations_enabled"]}
        >
          <div className="flex md:justify-end">
            <Switch
              id="settings-animations"
              checked={settings.animations_enabled}
              onCheckedChange={(checked) => save({ animations_enabled: checked })}
            />
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("region.title")} description={t("region.description")}>
        <SettingRow
          id="settings-country"
          label={t("region.country")}
          hint={
            <>
              {browserCountry
                ? t("region.countryDetected", { country: countryName(browserCountry, uiLocale) })
                : t("region.countryHint")}
              {browserCountry && browserCountry !== settings.country_code && (
                <UseDetected
                  onClick={() => save({ country_code: browserCountry })}
                  label={t("region.useDetected")}
                />
              )}
            </>
          }
          fields={["country_code"]}
        >
          <OptionSelect
            id="settings-country"
            value={settings.country_code}
            options={countryOptions}
            onChange={(value) => save({ country_code: value })}
          />
        </SettingRow>

        <SettingRow
          id="settings-timezone"
          label={t("region.timeZone")}
          hint={
            <>
              {browserZone
                ? t("region.timeZoneDetected", { zone: browserZone.replaceAll("_", " ") })
                : t("region.timeZoneHint")}
              {browserZone && browserZone !== settings.timezone && (
                <UseDetected
                  onClick={() => save(zonePatch(browserZone))}
                  label={t("region.useDetected")}
                />
              )}
            </>
          }
          fields={["timezone"]}
        >
          <TimeZonePicker
            id="settings-timezone"
            value={settings.timezone}
            onChange={(value) => save(zonePatch(value))}
          />
        </SettingRow>

        <SettingRow
          id="settings-currency"
          label={t("region.currency")}
          hint={t("region.currencyHint")}
          fields={["currency"]}
        >
          <OptionSelect
            id="settings-currency"
            value={settings.currency}
            options={currencyOptions}
            onChange={(value) => save({ currency: value })}
          />
        </SettingRow>

        <SettingRow id="settings-date" label={t("region.dateFormat")} fields={["date_format"]}>
          <OptionSelect
            id="settings-date"
            value={settings.date_format}
            options={dateOptions}
            onChange={(value) => save({ date_format: value })}
          />
        </SettingRow>

        <SettingRow id="settings-time" label={t("region.timeFormat")} fields={["time_format"]}>
          <OptionSelect
            id="settings-time"
            value={settings.time_format}
            options={timeOptions}
            onChange={(value) => save({ time_format: value })}
          />
        </SettingRow>

        <SettingRow id="settings-number" label={t("region.numberFormat")} fields={["number_format"]}>
          <OptionSelect
            id="settings-number"
            value={settings.number_format}
            options={numberOptions}
            onChange={(value) => save({ number_format: value })}
          />
        </SettingRow>

        <SettingRow
          id="settings-week"
          label={t("region.firstDayOfWeek")}
          fields={["first_day_of_week"]}
        >
          <OptionSelect
            id="settings-week"
            value={String(settings.first_day_of_week)}
            options={weekOptions}
            onChange={(value) => save({ first_day_of_week: Number(value) })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("preview.title")} description={t("preview.description")}>
        <FormatPreview now={now} />
      </SettingsSection>
    </SettingsPage>
  );
}

/** The country follows the time zone; the user can still pick another one afterwards. */
function zonePatch(zone: string): UserSettingsPatch {
  const country = countryFromTimeZone(zone);
  return country ? { timezone: zone, country_code: country } : { timezone: zone };
}

function UseDetected({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="link" size="sm" onClick={onClick} className="ml-1 h-auto p-0 text-[13px]">
      <LocateFixedIcon aria-hidden className="size-3.5" />
      {label}
    </Button>
  );
}

function OptionSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  const items = useMemo(() => options.map(({ value, label }) => ({ value, label })), [options]);
  return (
    <Select
      value={value}
      items={items}
      onValueChange={(next) => {
        if (typeof next === "string" && next !== value) onChange(next);
      }}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-[min(var(--available-height),360px)]">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate">{option.label}</span>
              {option.detail && (
                <span className="shrink-0 text-xs text-ink-muted">{option.detail}</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
