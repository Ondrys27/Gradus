"use client";

import { useMemo, type ReactNode } from "react";
import { CheckIcon, CompassIcon } from "lucide-react";
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
import { useUserSettings } from "@/features/account/queries";
import { jarvisOverlay } from "@/features/jarvis/overlay-store";
import { isJarvisFrequency, JARVIS_FREQUENCIES } from "@/features/jarvis/proactive";
import { formatIsoTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { UserSettingsPatch } from "@/lib/user-settings";
import { cn } from "@/lib/utils";

/** Quiet hours offered when the user turns them on. */
const DEFAULT_QUIET = { from: 21, to: 8 } as const;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function Row({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between md:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="text-[15px] font-medium text-ink">
          {label}
        </label>
        {hint && <p className="text-xs text-ink-muted">{hint}</p>}
      </div>
      <div className="w-full shrink-0 md:w-80">{children}</div>
    </div>
  );
}

/**
 * Settings → Jarvis: whether he speaks up on his own, how often (often /
 * now and then / the morning brief only) and quiet hours in the user's zone.
 */
export function JarvisSettings({ save }: { save: (patch: UserSettingsPatch) => void }) {
  const t = useTranslations("settings.jarvis");
  const settings = useUserSettings();
  const format = useFormatSettings();
  const on = settings.jarvis_proactive;
  const frequency = isJarvisFrequency(settings.jarvis_frequency)
    ? settings.jarvis_frequency
    : "sometimes";
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
  );

  return (
    <div className="flex flex-col divide-y divide-line/60">
      <Row id="settings-jarvis-proactive" label={t("proactive")} hint={t("proactiveHint")}>
        <Switch
          id="settings-jarvis-proactive"
          checked={on}
          onCheckedChange={(checked) => save({ jarvis_proactive: checked })}
        />
      </Row>

      <Row
        id="settings-jarvis-frequency"
        label={t("frequency")}
        hint={t(`frequencyHint.${frequency}`)}
      >
        <div
          id="settings-jarvis-frequency"
          role="radiogroup"
          aria-label={t("frequency")}
          tabIndex={-1}
          className="grid grid-cols-3 gap-2 rounded-xl outline-none"
        >
          {JARVIS_FREQUENCIES.map((value) => {
            const checked = frequency === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={!on}
                onClick={() => !checked && save({ jarvis_frequency: value })}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-2 text-center text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
                  checked
                    ? "border-violet/60 bg-violet/15 text-ink"
                    : "border-line bg-canvas-deep/60 text-ink-soft hover:border-line-strong",
                )}
              >
                {checked && <CheckIcon aria-hidden className="size-3.5 shrink-0 text-violet" />}
                {t(`frequencies.${value}`)}
              </button>
            );
          })}
        </div>
      </Row>

      <Row id="settings-jarvis-quiet" label={t("quiet.title")} hint={t("quiet.hint")}>
        <div className="flex flex-col gap-3">
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
          {quiet && (
            <div className="grid grid-cols-2 gap-2">
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
          )}
        </div>
      </Row>
    </div>
  );
}

/** Settings → Help: the guided tour again, from the dashboard. */
export function HelpSettings() {
  const t = useTranslations("settings.help");
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[15px] font-medium text-ink">{t("tour")}</p>
        <p className="text-xs text-ink-muted">{t("tourHint")}</p>
      </div>
      <Button
        id="settings-help-tour"
        variant="secondary"
        className="self-start md:self-auto"
        onClick={() => jarvisOverlay.requestTour()}
      >
        <CompassIcon aria-hidden />
        {t("start")}
      </Button>
    </div>
  );
}
