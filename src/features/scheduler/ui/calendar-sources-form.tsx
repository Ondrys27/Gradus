"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarIcon, CheckIcon, LinkIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CALENDAR_SETTINGS_PATH,
  GOOGLE_START_FROM_SCHEDULER,
} from "@/features/calendar/sync/paths";
import { providerCardState } from "@/features/calendar/sync/overview";
import { useCalendarSyncOverview } from "@/features/calendar/sync/queries";
import { AppleForm } from "@/features/calendar/sync/ui/connections-settings";
import { cn } from "@/lib/utils";
import {
  resolveSources,
  sourceCount,
  type AvailableSources,
  type ResolvedSources,
} from "../calendar-sources";
import { useCalendarSubscriptions } from "../queries";

function same(a: ResolvedSources, b: ResolvedSources): boolean {
  const set = (list: string[]) => [...list].sort().join(",");
  return (
    a.gradus === b.gradus &&
    a.write === b.write &&
    set(a.calendars) === set(b.calendars) &&
    set(a.subscriptions) === set(b.subscriptions)
  );
}

/**
 * The scheduler's own calendars (30.4): "Where busy times come from" — the
 * Gradus calendar, each connected Google / Apple calendar, each subscribed
 * calendar — and "Where new bookings go" (Gradus always, plus one connected
 * calendar or none). Independent of what the Calendar section shows. Google
 * and Apple connect right here, as in Settings → Calendar. For one meeting
 * type (`profileValue` given) the same choice can override the profile's.
 */
export function CalendarSourcesForm({
  value,
  profileValue,
  editable,
  saving,
  saved,
  failed,
  onSave,
}: {
  /** The stored sources: the profile's, or the type's (null = the profile's). */
  value: unknown;
  /** For a meeting type: the profile's sources it inherits. */
  profileValue?: unknown;
  editable: boolean;
  saving: boolean;
  saved: boolean;
  failed: boolean;
  /** Null = a type back on the profile's sources. */
  onSave: (sources: ResolvedSources | null) => void;
}) {
  const t = useTranslations("scheduler.sources");
  const overview = useCalendarSyncOverview();
  const subscriptions = useCalendarSubscriptions();
  const params = useSearchParams();
  const googleResult = params.get("google");
  const forType = profileValue !== undefined;
  const [own, setOwn] = useState(!forType || value !== null);
  const [showApple, setShowApple] = useState(false);

  const available: AvailableSources = useMemo(
    () => ({
      calendars: (overview.data?.connections ?? [])
        .filter((connection) => connection.status === "active")
        .flatMap((connection) =>
          connection.calendars.map((calendar) => ({
            id: calendar.id,
            canWrite: calendar.canWrite,
            read: calendar.read,
            write: calendar.write,
          })),
        ),
      subscriptions: (subscriptions.data ?? []).map((item) => ({ id: item.id })),
    }),
    [overview.data, subscriptions.data],
  );
  const stored = useMemo(
    () =>
      forType
        ? resolveSources(profileValue ?? null, value ?? null, available)
        : resolveSources(value ?? null, null, available),
    [forType, profileValue, value, available],
  );
  const [draft, setDraft] = useState<ResolvedSources>(stored);
  // A save (or a new connection) changes what is stored: show it.
  useEffect(() => setDraft(stored), [stored]);
  useEffect(() => setOwn(!forType || value !== null), [forType, value]);

  if (overview.isPending || subscriptions.isPending)
    return <Skeleton className="h-48 rounded-2xl" />;

  const dirty = forType
    ? own !== (value !== null) || (own && !same(draft, stored))
    : !same(draft, stored);
  const disabled = !editable || (forType && !own);
  const connections = overview.data?.connections ?? [];
  const writable = connections
    .filter((connection) => connection.status === "active")
    .flatMap((connection) =>
      connection.calendars
        .filter((calendar) => calendar.canWrite)
        .map((calendar) => ({ ...calendar, provider: connection.provider })),
    );

  function toggle(kind: "calendars" | "subscriptions", id: string, on: boolean) {
    setDraft((current) => ({
      ...current,
      [kind]: on
        ? [...new Set([...current[kind], id])]
        : current[kind].filter((item) => item !== id),
    }));
  }

  const google = overview.data ? providerCardState(overview.data, "google") : "unavailable";
  const apple = overview.data ? providerCardState(overview.data, "apple") : "unavailable";

  return (
    <div className="flex flex-col gap-5" data-testid="scheduler-sources">
      {forType && (
        <label className="flex items-start gap-3 text-sm text-ink">
          <Checkbox
            checked={own}
            disabled={!editable}
            onCheckedChange={(checked) => setOwn(checked === true)}
            data-testid="type-own-sources"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{t("typeOwn")}</span>
            <span className="text-[13px] text-ink-muted">{t("typeOwnHint")}</span>
          </span>
        </label>
      )}

      {googleResult && (
        <FormAlert tone={googleResult === "connected" ? "success" : "error"}>
          {t(googleResult === "connected" ? "googleConnected" : "googleFailed")}
        </FormAlert>
      )}

      <fieldset className={cn("flex flex-col gap-3", disabled && "opacity-60")} disabled={disabled}>
        <legend className="mb-1 flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink">{t("busyTitle")}</span>
          <span className="text-[13px] text-ink-muted">{t("busyHint")}</span>
        </legend>
        <SourceRow
          id="source-gradus"
          label={t("gradus")}
          hint={t("gradusHint")}
          checked={draft.gradus}
          onChange={(on) => setDraft((current) => ({ ...current, gradus: on }))}
        />
        {connections.map((connection) => (
          <div key={connection.id} className="flex flex-col gap-2">
            <span className="micro-label">
              {t(connection.provider === "apple" ? "apple" : "google")}
              {connection.accountLabel ? ` · ${connection.accountLabel}` : ""}
            </span>
            {connection.status !== "active" && (
              <p className="text-[13px] text-pink">{t("connectionBroken")}</p>
            )}
            {connection.calendars.map((calendar) => (
              <SourceRow
                key={calendar.id}
                id={`source-${calendar.id}`}
                label={calendar.name}
                hint={calendar.read ? undefined : t("notShown")}
                checked={draft.calendars.includes(calendar.id)}
                disabled={connection.status !== "active"}
                onChange={(on) => toggle("calendars", calendar.id, on)}
              />
            ))}
          </div>
        ))}
        {(subscriptions.data ?? []).length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="micro-label">{t("subscriptions")}</span>
            {(subscriptions.data ?? []).map((item) => (
              <SourceRow
                key={item.id}
                id={`source-${item.id}`}
                label={item.name}
                hint={item.url_hint}
                checked={draft.subscriptions.includes(item.id)}
                onChange={(on) => toggle("subscriptions", item.id, on)}
              />
            ))}
          </div>
        )}
        {sourceCount(draft) === 0 && <p className="text-[13px] text-gold">{t("noneChecked")}</p>}
        <p className="text-xs text-ink-muted">{t("bookingsAlways")}</p>
      </fieldset>

      {!forType && editable && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {google === "connect" && (
              <a
                href={GOOGLE_START_FROM_SCHEDULER}
                className={buttonVariants({ variant: "outline", size: "sm" })}
                data-testid="scheduler-connect-google"
              >
                <LinkIcon aria-hidden data-icon="inline-start" />
                {t("connectGoogle")}
              </a>
            )}
            {apple === "connect" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowApple((open) => !open)}
              >
                <LinkIcon aria-hidden data-icon="inline-start" />
                {t("connectApple")}
              </Button>
            )}
            <Link
              href={`${CALENDAR_SETTINGS_PATH}?focus=settings-calendar-subscriptions`}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <CalendarIcon aria-hidden data-icon="inline-start" />
              {t("addSubscription")}
            </Link>
          </div>
          {showApple && apple === "connect" && <AppleForm from="scheduler" />}
          {(google === "notAllowed" || apple === "notAllowed") && (
            <p className="text-xs text-ink-muted">{t("connectPreparing")}</p>
          )}
        </div>
      )}

      <fieldset className={cn("flex flex-col gap-2", disabled && "opacity-60")} disabled={disabled}>
        <legend className="mb-1 flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink">{t("writeTitle")}</span>
          <span className="text-[13px] text-ink-muted">{t("writeHint")}</span>
        </legend>
        <WriteOption
          label={t("writeGradus")}
          checked={draft.write === null}
          onPick={() => setDraft((current) => ({ ...current, write: null }))}
        />
        {writable.map((calendar) => (
          <WriteOption
            key={calendar.id}
            label={t("writeAlso", {
              name: calendar.name,
              provider: t(calendar.provider === "apple" ? "apple" : "google"),
            })}
            checked={draft.write === calendar.id}
            onPick={() => setDraft((current) => ({ ...current, write: calendar.id }))}
          />
        ))}
      </fieldset>

      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={!dirty || saving}
            data-testid="scheduler-sources-save"
            onClick={() => onSave(forType && !own ? null : draft)}
          >
            {saving ? t("saving") : t("save")}
          </Button>
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(stored);
                setOwn(!forType || value !== null);
              }}
            >
              {t("discard")}
            </Button>
          )}
          {saved && !dirty && <span className="text-sm text-green">{t("saved")}</span>}
        </div>
      )}
    </div>
  );
}

function SourceRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-1 text-sm text-ink"
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{label}</span>
        {hint && <span className="truncate text-xs text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

function WriteOption({
  label,
  checked,
  onPick,
}: {
  label: string;
  checked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onPick}
      className={cn(
        "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl border px-3 text-left text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-violet/40",
        checked
          ? "border-violet/60 bg-violet/10 text-ink"
          : "border-line text-ink-soft hover:text-ink",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full border-2",
          checked ? "border-violet bg-violet text-on-violet" : "border-line-strong",
        )}
      >
        {checked && <CheckIcon className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
