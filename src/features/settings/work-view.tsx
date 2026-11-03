"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUserSettings } from "@/features/account/queries";
import { InvoiceSettings } from "@/features/invoices/invoice-settings";
import { ColdCallingDealStageSelect } from "./cold-calling-settings";
import { GameSettings } from "./game-settings";
import { useSettingsSave } from "./save-state";
import { SettingRow, SettingsPage, SettingsSection } from "./ui";
import { useSettingsViewer } from "./use-visible-settings";

const REENGAGE_PRESETS = [1, 3, 6, 12];
/** Ten years; anything longer would overflow the integer column long before it made sense. */
const REENGAGE_MAX = 120;
const CUSTOM = "custom";

/**
 * Settings → Work: how the business parts behave — the game and the path,
 * the pipeline's second chance, where a deal from Cold Calling lands, and
 * the invoices. A worker sees only what their rights cover.
 */
export function WorkView() {
  const t = useTranslations("settings");
  const viewer = useSettingsViewer();
  const settings = useUserSettings();
  const { save } = useSettingsSave();
  const nothing = viewer.worker && !viewer.caller;

  return (
    <SettingsPage title={t("groups.work.title")} description={t("groups.work.description")}>
      {nothing && <p className="text-sm text-ink-muted">{t("work.nothing")}</p>}

      {!viewer.worker && <GameSettings />}

      {viewer.owner && (
        <SettingsSection title={t("pipeline.title")} description={t("pipeline.description")}>
          <SettingRow
            id="settings-reengage"
            label={t("pipeline.reengage")}
            hint={t("pipeline.reengageHint")}
            fields={["reengage_after_months"]}
          >
            <ReengageMonthsControl
              id="settings-reengage"
              value={settings.reengage_after_months}
              onChange={(months) => save({ reengage_after_months: months })}
            />
          </SettingRow>
        </SettingsSection>
      )}

      {viewer.caller && (
        <SettingsSection title={t("coldCalling.title")} description={t("coldCalling.description")}>
          <SettingRow
            id="settings-cold-calling-stage"
            label={t("coldCalling.dealStage")}
            hint={t("coldCalling.dealStageHint")}
            fields={["cold_calling_deal_stage_id"]}
          >
            <ColdCallingDealStageSelect id="settings-cold-calling-stage" save={save} />
          </SettingRow>
        </SettingsSection>
      )}

      {viewer.owner && (
        <SettingsSection
          id="settings-invoices"
          title={t("invoices.title")}
          description={t("invoices.description")}
        >
          <div data-setting-row className="rounded-xl">
            <InvoiceSettings />
          </div>
        </SettingsSection>
      )}
    </SettingsPage>
  );
}

/**
 * Presets of 1/3/6/12 months, plus a custom number. Picking "custom" only switches the
 * UI; the setting itself changes once a valid number is confirmed (Enter or leaving).
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
          className="w-24"
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
