"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { listTimeZones } from "@/lib/region";
import { saveDigestPrefs, sendDigestPreviewAction } from "../server/digest-actions";

export type DigestPrefsValue = {
  enabled: boolean;
  hour: number;
  onlyNews: boolean;
  timeZone: string | null;
};

const ACCOUNT_ZONE = "account";

/**
 * One administrator's daily summary (30.1): on or off, the hour, the time
 * zone (the account's by default), only when there is news. Saved with the
 * button; the preview sends yesterday's e-mail to oneself now.
 */
export function DigestPrefsForm({
  userId,
  initial,
  accountZone,
  hourLabels,
  readOnly,
  own,
}: {
  userId: string;
  initial: DigestPrefsValue;
  /** The zone used without a choice (the account's, else the metrics'). */
  accountZone: string;
  /** "6:00" for each hour 0–23, written by the server through format.ts. */
  hourLabels: string[];
  readOnly: boolean;
  own: boolean;
}) {
  const t = useTranslations("admin.digest");
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const zones = useMemo(
    () => [{ value: ACCOUNT_ZONE, label: t("zoneAccount", { zone: accountZone }) }, ...listTimeZones().map((zone) => ({ value: zone, label: zone }))],
    [accountZone, t],
  );
  const hours = hourLabels.map((label, hour) => ({ value: String(hour), label }));
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  const id = `digest-${userId.slice(0, 8)}`;

  function save() {
    setNotice(null);
    startTransition(async () => {
      const result = await saveDigestPrefs(userId, value);
      if (!result.ok) return setNotice({ tone: "error", text: t(`errors.${result.error}`) });
      setNotice({ tone: "success", text: t("saved") });
      router.refresh();
    });
  }

  function preview() {
    setNotice(null);
    startTransition(async () => {
      const result = await sendDigestPreviewAction();
      setNotice(
        result.ok
          ? { tone: "success", text: t("previewSent") }
          : { tone: "error", text: t(`errors.${result.error}`) },
      );
    });
  }

  const disabled = readOnly || pending;
  return (
    <div className="flex flex-col gap-4" data-testid="digest-prefs">
      <label className="flex min-h-11 items-center justify-between gap-4">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink">{t("enabled")}</span>
          <span className="text-sm text-ink-soft">{value.enabled ? t("on") : t("off")}</span>
        </span>
        <Switch
          checked={value.enabled}
          disabled={disabled}
          aria-label={t("enabled")}
          onCheckedChange={(enabled) => setValue((current) => ({ ...current, enabled }))}
        />
      </label>

      {value.enabled && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${id}-hour`} className="text-xs font-medium text-ink-muted">
                {t("hour")}
              </label>
              <Select
                value={String(value.hour)}
                items={hours}
                disabled={disabled}
                onValueChange={(next) => {
                  if (typeof next === "string") setValue((current) => ({ ...current, hour: Number(next) }));
                }}
              >
                <SelectTrigger id={`${id}-hour`} className="h-11 text-sm mouse:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[min(var(--available-height),320px)]">
                  {hours.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${id}-zone`} className="text-xs font-medium text-ink-muted">
                {t("zone")}
              </label>
              <Select
                value={value.timeZone ?? ACCOUNT_ZONE}
                items={zones}
                disabled={disabled}
                onValueChange={(next) => {
                  if (typeof next !== "string") return;
                  setValue((current) => ({ ...current, timeZone: next === ACCOUNT_ZONE ? null : next }));
                }}
              >
                <SelectTrigger id={`${id}-zone`} className="h-11 text-sm mouse:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[min(var(--available-height),320px)]">
                  {zones.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex min-h-11 items-start gap-3 text-sm text-ink">
            <Checkbox
              checked={value.onlyNews}
              disabled={disabled}
              onCheckedChange={(onlyNews) => setValue((current) => ({ ...current, onlyNews: onlyNews === true }))}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t("onlyNews")}</span>
              <span className="text-ink-soft">{t("onlyNewsHint")}</span>
            </span>
          </label>
        </>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={pending || !changed}>
            {t("save")}
          </Button>
          {own && (
            <Button variant="secondary" onClick={preview} disabled={pending}>
              {t("preview")}
            </Button>
          )}
        </div>
      )}
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
    </div>
  );
}
