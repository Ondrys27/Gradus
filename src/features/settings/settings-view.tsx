"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircleIcon, CheckIcon, LoaderCircleIcon, LocateFixedIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { GlowCard } from "@/components/ui/glow-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Stagger, StaggerItem } from "@/components/ui/stagger";
import { Switch } from "@/components/ui/switch";
import { useUpdateSettings, useUserSettings } from "@/features/account/queries";
import { locales } from "@/i18n/locales";
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
import { useUrlIntent } from "@/lib/use-url-intent";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/features/account/workspace-queries";
import { FakturoidIntegration } from "./fakturoid-integration";
import { FormatPreview, useNow } from "./format-preview";
import { JarvisTest } from "./jarvis-test";
import { TimeZonePicker } from "./time-zone-picker";

type Option = { value: string; label: string; detail?: string };

const REENGAGE_PRESETS = [1, 3, 6, 12];
/** Ten years; anything longer would overflow the integer column long before it made sense. */
const REENGAGE_MAX = 120;

export function SettingsView() {
  const t = useTranslations("settings");
  // A worker sets only their own formats; the business settings stay the owner's.
  const isOwner = useWorkspace().role === "owner";
  const uiLocale = useLocale();
  const settings = useUserSettings();
  const format = useFormatSettings();
  const update = useUpdateSettings();
  const now = useNow();
  const save = (patch: UserSettingsPatch) => update.mutate(patch);

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
    return codes.map((code) => ({
      value: code,
      label: code,
      detail: currencyName(code, uiLocale),
    }));
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
    label: formatNumber(
      1234567.89,
      { decimals: 2 },
      { ...format, numberLocale: NUMBER_FORMATS[key] },
    ),
  }));
  const weekOptions: Option[] = WEEK_STARTS.map((day) => ({
    value: String(day),
    label: weekdayName(day, uiLocale),
  }));

  // The search lands on one setting: bring its control into view and focus it.
  useUrlIntent("focus", (id) => {
    if (!/^settings-[a-z-]+$/.test(id)) return;
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
  });

  return (
    <Stagger className="flex flex-col gap-6">
      <StaggerItem>
        <PageHeader
          title={t("title")}
          description={t("description")}
          actions={<SaveStatus status={update.status} />}
        />
      </StaggerItem>

      <StaggerItem>
        <Section title={t("language.title")} description={t("language.description")}>
          <div
            id="settings-language"
            tabIndex={-1}
            role="radiogroup"
            aria-label={t("language.title")}
            className="grid gap-3 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:grid-cols-2"
          >
            {locales.map((code) => {
              const checked = settings.locale === code;
              return (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => !checked && save({ locale: code })}
                  className={cn(
                    "flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 text-left text-[15px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    checked
                      ? "border-violet/60 bg-violet/15 text-ink shadow-glow"
                      : "border-line bg-canvas-deep/60 text-ink-soft hover:border-line-strong",
                  )}
                >
                  {t(`language.options.${code}`)}
                  {checked && <CheckIcon aria-hidden className="size-4 text-violet" />}
                </button>
              );
            })}
          </div>
        </Section>
      </StaggerItem>

      <StaggerItem>
        <Section title={t("region.title")} description={t("region.description")}>
          <div className="flex flex-col divide-y divide-line/60">
            <SettingRow
              id="settings-country"
              label={t("region.country")}
              hint={
                browserCountry
                  ? t("region.countryDetected", { country: countryName(browserCountry, uiLocale) })
                  : t("region.countryHint")
              }
              action={
                browserCountry && browserCountry !== settings.country_code ? (
                  <UseDetected
                    onClick={() => save({ country_code: browserCountry })}
                    label={t("region.useDetected")}
                  />
                ) : null
              }
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
                browserZone
                  ? t("region.timeZoneDetected", { zone: browserZone.replaceAll("_", " ") })
                  : t("region.timeZoneHint")
              }
              action={
                browserZone && browserZone !== settings.timezone ? (
                  <UseDetected
                    onClick={() => save(zonePatch(browserZone))}
                    label={t("region.useDetected")}
                  />
                ) : null
              }
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
            >
              <OptionSelect
                id="settings-currency"
                value={settings.currency}
                options={currencyOptions}
                onChange={(value) => save({ currency: value })}
              />
            </SettingRow>

            <SettingRow id="settings-date" label={t("region.dateFormat")}>
              <OptionSelect
                id="settings-date"
                value={settings.date_format}
                options={dateOptions}
                onChange={(value) => save({ date_format: value })}
              />
            </SettingRow>

            <SettingRow id="settings-time" label={t("region.timeFormat")}>
              <OptionSelect
                id="settings-time"
                value={settings.time_format}
                options={timeOptions}
                onChange={(value) => save({ time_format: value })}
              />
            </SettingRow>

            <SettingRow id="settings-number" label={t("region.numberFormat")}>
              <OptionSelect
                id="settings-number"
                value={settings.number_format}
                options={numberOptions}
                onChange={(value) => save({ number_format: value })}
              />
            </SettingRow>

            <SettingRow id="settings-week" label={t("region.firstDayOfWeek")}>
              <OptionSelect
                id="settings-week"
                value={String(settings.first_day_of_week)}
                options={weekOptions}
                onChange={(value) => save({ first_day_of_week: Number(value) })}
              />
            </SettingRow>
          </div>
        </Section>
      </StaggerItem>

      <StaggerItem>
        <Section title={t("gameplay.title")} description={t("gameplay.description")}>
          <div className="flex flex-col divide-y divide-line/60">
            <SettingRow
              id="settings-sound"
              label={t("gameplay.sound")}
              hint={t("gameplay.soundHint")}
            >
              <Switch
                id="settings-sound"
                checked={settings.sound_enabled}
                onCheckedChange={(checked) => save({ sound_enabled: checked })}
              />
            </SettingRow>
            <SettingRow
              id="settings-animations"
              label={t("gameplay.animations")}
              hint={t("gameplay.animationsHint")}
            >
              <Switch
                id="settings-animations"
                checked={settings.animations_enabled}
                onCheckedChange={(checked) => save({ animations_enabled: checked })}
              />
            </SettingRow>
          </div>
        </Section>
      </StaggerItem>

      {isOwner && (
        <StaggerItem>
          <Section title={t("pipeline.title")} description={t("pipeline.description")}>
            <SettingRow
              id="settings-reengage"
              label={t("pipeline.reengage")}
              hint={t("pipeline.reengageHint")}
            >
              <ReengageMonthsControl
                id="settings-reengage"
                value={settings.reengage_after_months}
                onChange={(months) => save({ reengage_after_months: months })}
              />
            </SettingRow>
          </Section>
        </StaggerItem>
      )}

      <StaggerItem>
        <FormatPreview now={now} />
      </StaggerItem>

      <StaggerItem>
        <div
          id="settings-integrations"
          tabIndex={-1}
          className="rounded-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Section title={t("integrations.title")} description={t("integrations.description")}>
            {isOwner && <FakturoidIntegration />}
            <JarvisTest />
          </Section>
        </div>
      </StaggerItem>
    </Stagger>
  );
}

/** The country follows the time zone; the user can still pick another one afterwards. */
function zonePatch(zone: string): UserSettingsPatch {
  const country = countryFromTimeZone(zone);
  return country ? { timezone: zone, country_code: country } : { timezone: zone };
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <GlowCard interactive={false} className="flex flex-col gap-5 md:p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-ink-soft">{description}</p>
      </header>
      {children}
    </GlowCard>
  );
}

function SettingRow({
  id,
  label,
  hint,
  action,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between md:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="text-[15px] font-medium text-ink">
          {label}
        </label>
        {hint && <p className="text-xs text-ink-muted">{hint}</p>}
        {action}
      </div>
      <div className="w-full shrink-0 md:w-80">{children}</div>
    </div>
  );
}

function UseDetected({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="link" size="sm" onClick={onClick} className="-ml-2.5 self-start">
      <LocateFixedIcon aria-hidden />
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

const CUSTOM = "custom";

/**
 * Presets of 1/3/6/12 months, plus a custom number. Picking "custom" only switches the
 * UI; the setting itself changes once a valid number is confirmed.
 */
function ReengageMonthsControl({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (months: number) => void;
}) {
  const t = useTranslations("settings.pipeline");
  const [custom, setCustom] = useState(() => !REENGAGE_PRESETS.includes(value));
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const items = useMemo(
    () => [
      ...REENGAGE_PRESETS.map((months) => ({
        value: String(months),
        label: t("reengageMonths", { count: months }),
      })),
      { value: CUSTOM, label: t("reengageCustom") },
    ],
    [t],
  );

  function commitCustom() {
    const parsed = Number(text);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= REENGAGE_MAX) {
      if (parsed !== value) onChange(parsed);
    } else {
      setText(String(value));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={custom ? CUSTOM : String(value)}
        items={items}
        onValueChange={(next) => {
          if (next === CUSTOM) setCustom(true);
          else if (typeof next === "string") {
            setCustom(false);
            onChange(Number(next));
          }
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {custom && (
        <Input
          value={text}
          inputMode="numeric"
          aria-label={t("reengageCustomLabel")}
          className="h-11 w-24 mouse:h-9"
          onChange={(event) => setText(event.target.value)}
          onBlur={commitCustom}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      )}
    </div>
  );
}

function SaveStatus({ status }: { status: "idle" | "pending" | "success" | "error" }) {
  const t = useTranslations("settings.status");
  return (
    <p role="status" className="flex min-h-11 items-center gap-2 text-sm">
      {status === "pending" && (
        <>
          <LoaderCircleIcon
            aria-hidden
            className="size-4 animate-spin text-ink-muted motion-reduce:animate-none"
          />
          <span className="text-ink-muted">{t("saving")}</span>
        </>
      )}
      {status === "success" && (
        <>
          <CheckIcon aria-hidden className="size-4 text-green" />
          <span className="text-green">{t("saved")}</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircleIcon aria-hidden className="size-4 text-pink" />
          <span className="text-pink">{t("failed")}</span>
        </>
      )}
      {status === "idle" && <span className="text-ink-muted">{t("auto")}</span>}
    </p>
  );
}
