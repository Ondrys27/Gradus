"use client";

import { useMemo } from "react";
import { CompassIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSession, useUserSettings } from "@/features/account/queries";
import { jarvisOverlay } from "@/features/jarvis/overlay-store";
import { JARVIS_FREQUENCIES, toJarvisFrequency } from "@/features/jarvis/proactive";
import { formatIsoTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useSettingsSave } from "./save-state";
import { ActionRow, ChoiceGrid, ChoiceTile, SettingRow, SettingsPage, SettingsSection } from "./ui";

/** Quiet hours offered when the user turns them on. */
const DEFAULT_QUIET = { from: 21, to: 8 } as const;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * Settings → Jarvis: whether he speaks up on his own, how often (every 2 or
 * 6 hours besides the summary of the day, or only a summary once a day,
 * week or month), quiet hours in the user's zone, the notifications of
 * Messages (e-mail when away, sound) and the guided tour again. A worker has
 * no Jarvis of their own; they get the notifications and the tour.
 */
export function JarvisView() {
  const t = useTranslations("settings");
  const { worker } = useSession();
  return (
    <SettingsPage title={t("groups.jarvis.title")} description={t("groups.jarvis.description")}>
      {!worker && <ProactiveSection />}
      <MessagesSection />
      <SettingsSection title={t("help.title")} description={t("help.description")}>
        <ActionRow
          id="settings-help-tour"
          label={t("help.tour")}
          hint={t("help.tourHint")}
          action={
            <Button
              id="settings-help-tour"
              variant="secondary"
              onClick={() => jarvisOverlay.requestTour()}
            >
              <CompassIcon aria-hidden />
              {t("help.start")}
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPage>
  );
}

function ProactiveSection() {
  const t = useTranslations("settings.jarvis");
  const settings = useUserSettings();
  const format = useFormatSettings();
  const { save } = useSettingsSave();
  const on = settings.jarvis_proactive;
  const frequency = toJarvisFrequency(settings.jarvis_frequency);
  const quiet = settings.jarvis_quiet_from !== null && settings.jarvis_quiet_to !== null;

  const hourItems = useMemo(
    () =>
      HOURS.map((hour) => ({
        value: String(hour),
        label: formatIsoTime(`${String(hour).padStart(2, "0")}:00`, format),
      })),
    [format],
  );

  const hourSelect = (id: string, value: number, other: number, field: "from" | "to") => (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-xs text-ink-muted">{t(`quiet.${field}`)}</span>
      <Select
        value={String(value)}
        items={hourItems}
        disabled={!on}
        onValueChange={(next) => {
          const hour = Number(next);
          if (!Number.isInteger(hour) || hour === value || hour === other) return;
          save(field === "from" ? { jarvis_quiet_from: hour } : { jarvis_quiet_to: hour });
        }}
      >
        <SelectTrigger id={id} aria-label={t(`quiet.${field}`)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[min(var(--available-height),320px)]">
          {hourItems.map((item) => (
            <SelectItem key={item.value} value={item.value} disabled={Number(item.value) === other}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );

  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <SettingRow
        id="settings-jarvis-proactive"
        label={t("proactive")}
        hint={t("proactiveHint")}
        fields={["jarvis_proactive"]}
      >
        <div className="flex md:justify-end">
          <Switch
            id="settings-jarvis-proactive"
            checked={on}
            onCheckedChange={(checked) => save({ jarvis_proactive: checked })}
          />
        </div>
      </SettingRow>

      <SettingRow
        id="settings-jarvis-frequency"
        label={t("frequency")}
        hint={t(`frequencyHint.${frequency}`)}
        fields={["jarvis_frequency"]}
        group
        layout="stack"
      >
        <ChoiceGrid id="settings-jarvis-frequency" label={t("frequency")} columns={3}>
          {JARVIS_FREQUENCIES.map((value) => (
            <ChoiceTile
              key={value}
              checked={frequency === value}
              disabled={!on}
              onSelect={() => save({ jarvis_frequency: value })}
              title={t(`frequencies.${value}`)}
            />
          ))}
        </ChoiceGrid>
      </SettingRow>

      <SettingRow
        id="settings-jarvis-quiet"
        label={t("quiet.title")}
        hint={t("quiet.hint")}
        fields={["jarvis_quiet_from", "jarvis_quiet_to"]}
      >
        <div className="flex md:justify-end">
          <Switch
            id="settings-jarvis-quiet"
            checked={quiet}
            disabled={!on}
            onCheckedChange={(checked) =>
              save(
                checked
                  ? { jarvis_quiet_from: DEFAULT_QUIET.from, jarvis_quiet_to: DEFAULT_QUIET.to }
                  : { jarvis_quiet_from: null, jarvis_quiet_to: null },
              )
            }
          />
        </div>
      </SettingRow>
      {quiet && (
        <SettingRow id="settings-jarvis-quiet-from" label={t("quiet.hours")} group>
          <div className="flex gap-2">
            {hourSelect(
              "settings-jarvis-quiet-from",
              settings.jarvis_quiet_from!,
              settings.jarvis_quiet_to!,
              "from",
            )}
            {hourSelect(
              "settings-jarvis-quiet-to",
              settings.jarvis_quiet_to!,
              settings.jarvis_quiet_from!,
              "to",
            )}
          </div>
        </SettingRow>
      )}
    </SettingsSection>
  );
}

/** Messages: an e-mail about direct messages and mentions while away, and the sound of a new one. */
function MessagesSection() {
  const t = useTranslations("settings.chat");
  const settings = useUserSettings();
  const { save } = useSettingsSave();
  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <SettingRow
        id="settings-chat-email"
        label={t("email")}
        hint={t("emailHint")}
        fields={["chat_email_notifications"]}
      >
        <div className="flex md:justify-end">
          <Switch
            id="settings-chat-email"
            checked={settings.chat_email_notifications}
            onCheckedChange={(checked) => save({ chat_email_notifications: checked })}
          />
        </div>
      </SettingRow>
      <SettingRow
        id="settings-chat-sound"
        label={t("sound")}
        hint={t("soundHint")}
        fields={["chat_sound"]}
      >
        <div className="flex md:justify-end">
          <Switch
            id="settings-chat-sound"
            checked={settings.chat_sound}
            onCheckedChange={(checked) => save({ chat_sound: checked })}
          />
        </div>
      </SettingRow>
    </SettingsSection>
  );
}
